import { google } from "googleapis";
import { GoogleGenAI } from "@google/genai";

export default async function handler(req, res) {
  // CORS preflight support
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const { accessToken, refreshToken, email, subject, notes, slots, meetingSchedulerLabelId } = req.body;

  // Build slot-options list
  const options = (slots || [])
    .map(s => `• ${new Date(s.start).toLocaleString()} — ${new Date(s.end).toLocaleTimeString()}`)
    .join("\n");

  // Draft via Gen AI SDK
  let draft;
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY });
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: `You are a helpful assistant. Write a polite email to ${email} proposing a meeting about "${subject}".\nHere are some times:\n\n${options}\n\nNotes: ${notes}`
    });
    draft = response.text.trim();
  } catch (err) {
    console.error("GenAI draft error:", err);
    return res.status(500).json({ error: "GenAI draft error", details: err.message });
  }

  // Configure Gmail client
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
  const gmail = google.gmail({ version: "v1", auth });

  // Send with custom label applied
  const rawMessage = [
    `To: ${email}`,
    `Subject: Meeting about ${subject}`,
    "",
    draft
  ].join("\r\n");
  const raw = Buffer.from(rawMessage).toString("base64");

  try {
    await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw,
        labelIds: [meetingSchedulerLabelId]
      }
    });
  } catch (err) {
    console.error("Gmail send error:", err);
    return res.status(500).json({ error: "Gmail send error", details: err.message });
  }

  return res.status(200).json({ message: "Proposal sent!", draft });
}