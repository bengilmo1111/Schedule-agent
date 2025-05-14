// pages/api/webhook/reply.js
import { google } from "googleapis";
import { GoogleGenAI } from "@google/genai";
import prisma from "../../../lib/prisma";

// This endpoint will receive Gmail push notifications
export default async function handler(req, res) {
  // 0) ACK the push immediately
  console.log("[Webhook] payload:", JSON.stringify(req.body));
  res.status(200).end();

  // 1) Parse Pub/Sub push
  const { message } = req.body;
  if (!message?.data) return;
  const notif = JSON.parse(
    Buffer.from(message.data, 'base64').toString('utf-8')
  );
  const historyId = notif.historyId;

  // 2) Retrieve user tokens from DB
  const account = await prisma.account.findFirst({
    where: { provider: "google" }
  });
  if (!account?.access_token || !account?.refresh_token) {
    console.error("[Webhook] Missing OAuth tokens");
    return;
  }

  // 3) Initialize authenticated Gmail & Calendar clients
  const auth = new google.auth.OAuth2();
  auth.setCredentials({
    access_token:  account.access_token,
    refresh_token: account.refresh_token
  });
  const gmail    = google.gmail({ version: "v1", auth });
  const calendar = google.calendar({ version: "v3", auth });
  const ai       = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY });

  try {
    // 4) Fetch history of new messages
    const historyRes = await gmail.users.history.list({
      userId: "me",
      startHistoryId: historyId,
      historyTypes: ["messageAdded"]
    });
    const messages = historyRes.data.history
      ?.flatMap(h => h.messagesAdded?.map(m => m.message.id)) || [];

    for (const msgId of messages) {
      // 5) Fetch full message
      const msgRes = await gmail.users.messages.get({
        userId: "me",
        id: msgId,
        format: 'full'
      });
      const { threadId } = msgRes.data;

      // 6) Lookup meetingThread by threadId
      const record = await prisma.meetingThread.findUnique({
        where: { threadId }
      });
      if (!record) {
        console.log("[Webhook] No meeting record for thread:", threadId);
        continue;
      }

      // 7) Extract reply text from message body
      let body = msgRes.data.snippet;
      const part = msgRes.data.payload.parts?.find(p => p.mimeType === 'text/plain');
      if (part?.body?.data) {
        body = Buffer.from(part.body.data, 'base64').toString('utf-8');
      }

      // 8) Parse agreed slot via GenAI
      const parseRes = await ai.models.generateContent({
        model: 'gemini-2.0-flash-lite',
        contents: `Extract the meeting date and time from this reply: "${body}"`
      });
      const agreed = parseRes.candidates?.[0]?.output?.trim() || parseRes.text;
      console.log("[Webhook] Agreed slot:", agreed);

      // 9) Convert to start/end ISO datetimes
      const start = new Date(agreed);
      const end = new Date(start.getTime() + /* assume default duration, e.g. 30min */ 30 * 60000);

      // 10) Create calendar event
      await calendar.events.insert({
        calendarId: 'primary',
        requestBody: {
          summary:   record.subject,
          start:     { dateTime: start.toISOString() },
          end:       { dateTime: end.toISOString() },
          attendees: [{ email: record.attendeeEmail }],
          sendUpdates: 'all'
        }
      });
      console.log("[Webhook] Created event for thread:", threadId);
    }
  } catch (err) {
    console.error("[Webhook] Error processing reply:", err);
  }
}
