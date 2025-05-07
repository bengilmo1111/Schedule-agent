import { google } from "googleapis";

export default async function handler(req, res) {
  const { accessToken, refreshToken, duration } = req.body;
  // 1) Set up Auth client
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken, refresh_token: refreshToken });

  // 2) Query freebusy for the next 7 days
  const cal = google.calendar({ version: "v3", auth });
  const now = new Date();
  const weekLater = new Date(now);
  weekLater.setDate(now.getDate() + 7);

  const fb = await cal.freebusy.query({
    requestBody: {
      timeMin: now.toISOString(),
      timeMax: weekLater.toISOString(),
      timeZone: "Pacific/Auckland",
      items: [{ id: "primary" }],
    },
  });

  const busy = fb.data.calendars.primary.busy;
  // 3) Compute open slots (helper below)
  const slots = computeOpenSlots(busy, duration);

  res.status(200).json({ slots: slots.slice(0, 5) });
}

// Simple helper—find gaps of at least “duration” minutes between 9–17 each day
function computeOpenSlots(busy, duration) {
  const slots = [];
  const dayMillis = 24 * 60 * 60 * 1000;
  const startHour = 9, endHour = 17;

  const startDate = new Date();
  for (let i = 0; i < 7; i++) {
    const day = new Date(startDate.getTime() + i * dayMillis);
    const dayStart = new Date(day.setHours(startHour, 0, 0, 0));
    const dayEnd   = new Date(day.setHours(endHour,   0, 0, 0));
    let cursor = dayStart;

    // sort and filter busy events for this day
    const todayBusy = busy
      .map(b => ({ start: new Date(b.start), end: new Date(b.end) }))
      .filter(b => b.end > dayStart && b.start < dayEnd)
      .sort((a, b) => a.start - b.start);

    for (const b of todayBusy) {
      if ((b.start - cursor) / 60000 >= duration) {
        slots.push({ start: cursor, end: new Date(cursor.getTime() + duration * 60000) });
      }
      cursor = new Date(Math.max(cursor, b.end));
    }
    if ((dayEnd - cursor) / 60000 >= duration) {
      slots.push({ start: cursor, end: new Date(cursor.getTime() + duration * 60000) });
    }
  }

  return slots;
}