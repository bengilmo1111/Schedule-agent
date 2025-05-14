// pages/api/send-proposals.js
import { google } from "googleapis";
import { GoogleGenAI } from "@google/genai";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import prisma from "../../lib/prisma";

export default async function handler(req, res) {
  // 0) CORS preflight support
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

  // 1) Authenticate user session
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  const accessToken  = session.user.accessToken;
  const refreshToken = session.user.refreshToken;

  // 2) Pull form data
  const { email, subject, notes, slots } = req.body;

  // 3) Upsert the user in the database to get proper userId
  let userRecord;
  try {
    userRecord = await prisma.user.upsert({
      where: { email: session.user.email },
      create: {
        email: session.user.email,
        name:  session.user.name || null,
        image: session.user.image || null
      },
      update: {}
    });
  } catch (err) {
    console.error("User upsert error:", err);
    return res
      .status(500)
      .json({ error: "User upsert error", details: err.message });
  }
  const userId = userRecord.id;

  // 4) Build the time-slot list
  const options = (slots || [])
    .map(
      (s) => `• ${new Date(s.start).toLocaleString()} — ${new Date(
        s.end
      ).toLocaleTimeString()}`
    )
    .join("\n");

  // 5) Initialize Gmail client
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
  const gmail = google.gmail({ version: "v1", auth });

  // 6) Ensure “MeetingScheduler” label exists & get its ID
  let meetingSchedulerLabelId;
  try {
    const labelsRes = await gmail.users.labels.list({ userId: "me" });
    let schedLabel = (labelsRes.data.labels || []).find(
      (l) => l.name === "MeetingScheduler"
    );
    if (!schedLabel) {
      const createRes = await gmail.users.labels.create({
        userId: "me",
        requestBody: { name: "MeetingScheduler" },
      });
      schedLabel = createRes.data;
    }
    meetingSchedulerLabelId = schedLabel.id;
  } catch (err) {
    console.error("Label init error:", err);
    return res
      .status(500)
      .json({ error: "Label init error", details: err.message });
  }

  // 7) Draft email via Gemini
  let draft;
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY });
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: `You are a helpful assistant. Write a polite email to ${email} proposing a meeting about "${subject}".\nHere are some times:\n\n${options}\n\nNotes: ${notes}`,
    });
    draft = response.text.trim();
  } catch (err) {
    console.error("GenAI draft error:", err);
    return res
      .status(500)
      .json({ error: "GenAI draft error", details: err.message });
  }

  // 8) Send the email
  const rawMessage = [
    `To: ${email}`,
    `Subject: Meeting about ${subject}`,
    "",
    draft,
  ].join("\r\n");
  const raw = Buffer.from(rawMessage).toString("base64");

  let sendRes;
  try {
    sendRes = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw },
    });
  } catch (err) {
    console.error("Gmail send error:", err);
    return res
      .status(500)
      .json({ error: "Gmail send error", details: err.message });
  }

  const messageId = sendRes.data.id;
  const threadId  = sendRes.data.threadId;

  // 9) Apply the custom label
  try {
    await gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody: { addLabelIds: [meetingSchedulerLabelId] },
    });
  } catch (err) {
    console.error("Error labeling message:", err);
    return res
      .status(500)
      .json({ error: "Labeling error", details: err.message });
  }

  // 10) Persist the new thread in your database
  try {
    await prisma.meetingThread.create({
      data: {
        threadId,
        userId,
        attendeeEmail: email,
        subject,
        slots: JSON.stringify(slots),
      },
    });
  } catch (err) {
    console.error("DB write error:", err);
    return res
      .status(500)
      .json({ error: "Database error", details: err.message });
  }

  // 11) Return success
  return res
    .status(200)
    .json({ message: "Proposal sent, labeled & recorded!", draft });
}