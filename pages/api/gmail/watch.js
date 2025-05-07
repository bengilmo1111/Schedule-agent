// pages/api/gmail/watch.js
import { google } from "googleapis";
import { getSession } from "next-auth/react";

export default async function handler(req, res) {
  // Only allow GET requests
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  // 1) Validate user session
  const session = await getSession({ req });
  if (!session) {
    return res.status(401).json({ error: "Not signed in" });
  }

  // 2) Read Pub/Sub topic from env
  const topicName = process.env.GMAIL_PUBSUB_TOPIC;
  if (!topicName) {
    console.error("Missing GMAIL_PUBSUB_TOPIC environment variable");
    return res.status(500).json({ error: "Missing GMAIL_PUBSUB_TOPIC environment variable" });
  }

  // 3) Initialize Gmail API client
  const auth = new google.auth.OAuth2();
  auth.setCredentials({
    access_token:  session.user.accessToken,
    refresh_token: session.user.refreshToken,
  });
  const gmail = google.gmail({ version: "v1", auth });

  // 4) Ensure custom label exists
  let labelId;
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
    labelId = schedLabel.id;
  } catch (err) {
    console.error("Error fetching or creating label:", err);
    return res.status(500).json({ error: "Label init error", details: err.message });
  }

  // 5) Configure Gmail watch
  try {
    const watchRes = await gmail.users.watch({
      userId: "me",
      requestBody: {
        topicName: topicName,
        labelIds: [labelId],
        labelFilterBehavior: "INCLUDE"
      }
    });
    return res.status(200).json({ message: "Gmail watch configured", watch: watchRes.data });
  } catch (err) {
    console.error("Failed to set up Gmail watch:", err);
    return res.status(500).json({ error: "Watch setup error", details: err.message });
  }
}