// pages/api/find-slots.js
import { google } from "googleapis";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import prisma from "../../lib/prisma";

export default async function handler(req, res) {
  // CORS preflight support
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  // 1) Authenticate session
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: "Not authenticated" });

  // 2) Look up user in DB
  const user = await prisma.user.findUnique({ where: { email: session.user.email } });
  if (!user) return res.status(500).json({ error: "User not found" });

  // 3) Fetch OAuth tokens from Account table
  const account = await prisma.account.findFirst({
    where: { userId: user.id, provider: "google" }
  });
  if (!account?.access_token || !account?.refresh_token) {
    return res.status(500).json({ error: "OAuth tokens missing for user" });
  }

  // 4) Build authenticated Calendar client
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({
    access_token:  account.access_token,
    refresh_token: account.refresh_token
  });
  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  // 5) Read duration
  const { duration = 30 } = req.body;

  // 6) Compute free/busy window for next 7 days
  const now = new Date();
  const timeMin = now.toISOString();
  const timeMax = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

  let busy;
  try {
    const fbRes = await calendar.freebusy.query({
      requestBody: {
        timeMin,
        timeMax,
        timeZone: "Pacific/Auckland",
        items: [{ id: "primary" }]
      }
    });
    busy = fbRes.data.calendars.primary.busy || [];
  } catch (err) {
    console.error("Free/busy error:", err);
    return res.status(500).json({ error: "Free/busy query failed", details: err.message });
  }

  // 7) Compute open slots between 9–17 each day
  const slots = [];
  const dayMillis = 24 * 60 * 60 * 1000;
  const startHour = 9, endHour = 17;
  for (let i = 0; i < 7; i++) {
    const day = new Date(now.getTime() + i * dayMillis);
    const dayStart = new Date(day.setHours(startHour, 0, 0, 0));
    const dayEnd   = new Date(day.setHours(endHour,   0, 0, 0));
    let cursor = dayStart.getTime();

    const todayBusy = busy
      .map(b => ({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() }))
      .filter(b => b.end > dayStart.getTime() && b.start < dayEnd.getTime())
      .sort((a, b) => a.start - b.start);

    for (const b of todayBusy) {
      while (cursor + duration * 60000 <= b.start) {
        slots.push({
          start: new Date(cursor).toISOString(),
          end:   new Date(cursor + duration * 60000).toISOString()
        });
        cursor += duration * 60000;
      }
      cursor = Math.max(cursor, b.end);
    }

    while (cursor + duration * 60000 <= dayEnd.getTime()) {
      slots.push({
        start: new Date(cursor).toISOString(),
        end:   new Date(cursor + duration * 60000).toISOString()
      });
      cursor += duration * 60000;
    }
  }

  // 8) Return the first 3 slots
  return res.status(200).json({ slots: slots.slice(0, 3) });
}