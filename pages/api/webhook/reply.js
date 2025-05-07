import { google } from "googleapis";
import { GoogleGenAI } from "@google/genai";

// This endpoint will receive Gmail push notifications
export default async function handler(req, res) {
  // Acknowledge immediately
  console.log("[Webhook] payload:", JSON.stringify(req.body));
  res.status(200).end();

  // Parse the Pub/Sub push payload (Gmail watch notification)
  const { message } = req.body;
  if (!message || !message.data) return;

  // Decode the base64 message data
  const decoded = Buffer.from(message.data, 'base64').toString('utf-8');
  const notif = JSON.parse(decoded);

  // Only handle new messages notifications
  const historyId = notif.historyId;
  const userId = 'me';

  // Initialize Google APIs
  const auth = new google.auth.OAuth2();
  // Load stored tokens for User A
  auth.setCredentials({ 
    access_token: process.env.GOOGLE_ACCESS_TOKEN,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN 
  });
  const gmail = google.gmail({ version: 'v1', auth });
  const calendar = google.calendar({ version: 'v3', auth });

  // Fetch the history to get new messages
  const historyRes = await gmail.users.history.list({ userId, startHistoryId: historyId, historyTypes: ['messageAdded'] });
  const messages = historyRes.data.history?.flatMap(h => h.messagesAdded?.map(m=>m.message.id)) || [];

  for (const msgId of messages) {
    // Retrieve full message
    const msg = await gmail.users.messages.get({ userId, id: msgId, format: 'full' });
    // Check if this is a reply in our thread by matching Subject or In-Reply-To
    const headers = msg.data.payload.headers;
    const subjectHeader = headers.find(h=>h.name==='Subject')?.value || '';
    const threadId = msg.data.threadId;

    // Only process replies to our scheduling thread
    if (!subjectHeader.includes(subjectPrefix)) continue;

    // Extract the email body (plain text)
    let body = '';
    const part = msg.data.payload.parts?.find(p=>p.mimeType==='text/plain');
    if (part) body = Buffer.from(part.body.data, 'base64').toString('utf-8');

    // Use GenAI to parse agreed slot from reply
    const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY });
    const parseRes = await ai.models.generateContent({
      model: 'gemini-2.0-flash-lite',
      contents: `Extract the meeting date and time from this reply: "${body}"`  
    });
    const agreed = parseRes.text.trim();

    // Convert agreed text to ISO DateTime
    const start = new Date(agreed);
    const end = new Date(start.getTime() + requestDuration * 60000);

    // Create calendar event and send invite
    await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: originalSubject,
        description: originalNotes,
        start: { dateTime: start.toISOString() },
        end:   { dateTime: end.toISOString() },
        attendees: [{ email: replyFrom }],
      }
    });
  }
}