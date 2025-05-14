import { google } from "googleapis";
import { GoogleGenAI } from "@google/genai";
import { getSession } from "next-auth/react";
import prisma from "../../lib/prisma";

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

  // 1) Check user session
const session = await getSession({ req });
   if (!session) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { accessToken, refreshToken, email, subject, notes, slots } = req.body;

  // Build slot-options list
  const options = (slots || [])
    .map(
      (s) => `• ${new Date(s.start).toLocaleString()} — ${new Date(
        s.end
      ).toLocaleTimeString()}`
    )
    .join("\n");

  // Initialize Gmail client
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
  const gmail = google.gmail({ version: "v1", auth });

  // Ensure custom label exists and get its ID
  let meetingSchedulerLabelId;
  try {
    const labelsRes = await gmail.users.labels.list({ userId: "me" });
    let schedLabel = (labelsRes.data.labels || []).find(l => l.name === "MeetingScheduler");
    if (!schedLabel) {
      const createRes = await gmail.users.labels.create({
        userId: "me",
        requestBody: { name: "MeetingScheduler" }
      });
      schedLabel = createRes.data;
    }
    meetingSchedulerLabelId = schedLabel.id;
  } catch (err) {
    console.error("Label init error:", err);
    return res.status(500).json({ error: "Label init error", details: err.message });
  }

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

  // Send the email
  const rawMessage = [
    `To: ${email}`,
    `Subject: Meeting about ${subject}`,
    "",
    draft
  ].join("\r\n");
  const raw = Buffer.from(rawMessage).toString("base64");

  let messageId;
  try {
    const sendRes = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw }
    });
    messageId = sendRes.data.id;
  } catch (err) {
    console.error("Gmail send error:", err);
    return res.status(500).json({ error: "Gmail send error", details: err.message });
  }

  // Apply the custom label to the sent message
  try {
    await gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody: { addLabelIds: [meetingSchedulerLabelId] }
    });
  } catch (err) {
    console.error("Error labeling message:", err);
    return res.status(500).json({ error: "Labeling error", details: err.message });
  }

  const threadId = sendRes.data.threadId;

  // 6) Persist mapping in DB
  await prisma.meetingThread.create({
    data: {
      threadId,
      userId:        session.user.email,       // or session.user.id if you expose it
      attendeeEmail: email,
      subject,
      slots:         JSON.stringify(slots)
    }
  });

  // 7) Return success
  return res.status(200).json({ message: "Proposal sent, labeled & recorded!", draft });
 }