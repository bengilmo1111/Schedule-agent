import { google } from "googleapis";
import { GoogleGenAI } from "@google/genai";

export default async function handler(req, res) {
  const { accessToken, refreshToken, email, subject, notes, slots } = req.body;

  // Build slot-options list
  const options = slots
    .map(s => `• ${new Date(s.start).toLocaleString()} — ${new Date(s.end).toLocaleTimeString()}`)
    .join("\n");

  // Draft via Gen AI
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY });
  const { text: draft } = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: `
You are a helpful assistant. Write a polite email to ${email} proposing a meeting about "${subject}". 
Here are some times:

${options}

Notes: ${notes}`
  });

  // Configure Gmail client
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
  const gmail = google.gmail({ version: "v1", auth });

  // Send with your custom label applied
  const raw = Buffer.from(
    `To: ${email}\r\nSubject: Meeting about ${subject}\r\n\r\n${draft.trim()}`
  ).toString("base64");
  await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw,
      labelIds: [meetingSchedulerLabelId]       // ← apply your label here
    }
  });

  res.status(200).json({ message: "Proposal sent!", draft });
}