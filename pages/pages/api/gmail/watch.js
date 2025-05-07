// pages/api/gmail/watch.js
import { google } from "googleapis";
import { getSession } from "next-auth/react";

export default async function handler(req, res) {
  const session = await getSession({ req });
  if (!session) return res.status(401).send("Not signed in");

  // Initialize OAuth2 client with saved tokens
  const auth = new google.auth.OAuth2();
  auth.setCredentials({
    access_token:  session.user.accessToken,
    refresh_token: session.user.refreshToken,
  });

  const gmail = google.gmail({ version: "v1", auth });
  try {
    await gmail.users.watch({
      userId: "me",
      requestBody: {
        topicName: "projects/schedule-agent-458909/topics/gmail-watch",
        labelIds:  ["MeetingScheduler"],
        labelFilterBehavior: "INCLUDE"
      },
    });
    res.status(200).json({ message: "Gmail watch set up" });
  } catch (err) {
    console.error("Failed to set up Gmail watch:", err);
    res.status(500).json({ error: err.message });
  }
}