import { useSession, signIn, signOut } from "next-auth/react";
import { useState } from "react";

export default function Home() {
  const { data: session } = useSession();
  const [form, setForm] = useState({ email: "", duration: 30, subject: "", notes: "" });
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [watchMessage, setWatchMessage] = useState("");

  if (!session) {
    return (
      <div className="container">
        <button className="btn primary" onClick={() => signIn("google")}>
          Sign in with Google
        </button>
      </div>
    );
  }

  // Invoke Gmail watch
  const invokeWatch = async () => {
    setLoading(true);
    setWatchMessage("");
    try {
      const res = await fetch("/api/gmail/watch");
      const data = await res.json();
      setWatchMessage(res.ok ? "✅ Gmail watch configured" : `⚠️ ${data.error || data.message}`);
    } catch (err) {
      console.error(err);
      setWatchMessage("Error setting up Gmail watch. See console.");
    } finally {
      setLoading(false);
    }
  };

  // Find available slots
  const findSlots = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch("/api/find-slots", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ duration: form.duration }),
        });
      const data = await res.json();
      setSlots(data.slots || []);
    } catch (err) {
      console.error(err);
      setMessage("Error fetching slots.");
    } finally {
      setLoading(false);
    }
  };

  // Send proposal email
  const sendProposals = async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch("/api/send-proposals", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: session.user.accessToken,
          refreshToken: session.user.refreshToken,
          email: form.email,
          subject: form.subject,
          notes: form.notes,
          slots,
          meetingSchedulerLabelId: "MeetingScheduler"
        }),
      });
      const data = await res.json();
      setMessage(res.ok ? `✅ ${data.message}` : `⚠️ ${data.error || data.message}`);
    } catch (err) {
      console.error(err);
      setMessage("Error sending proposal.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <div className="header">
        <h1>Meeting Scheduler</h1>
        <button className="btn secondary" onClick={() => signOut()}>
          Sign Out
        </button>
      </div>

      <button className="btn secondary" onClick={invokeWatch} disabled={loading}>
        {loading ? "Setting up…" : "Setup Gmail Watch"}
      </button>
      {watchMessage && <div className="message info">{watchMessage}</div>}

      <form onSubmit={findSlots} className="form">
        <label>Attendee Email</label>
        <input
          type="email"
          required
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />

        <label>Duration (mins)</label>
        <input
          type="number"
          min={5}
          max={120}
          step={5}
          required
          value={form.duration}
          onChange={(e) => setForm({ ...form, duration: +e.target.value })}
        />

        <label>Subject</label>
        <input
          type="text"
          required
          value={form.subject}
          onChange={(e) => setForm({ ...form, subject: e.target.value })}
        />

        <label>Notes</label>
        <textarea
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />

        <button className="btn primary" type="submit" disabled={loading}>
          {loading ? "Finding…" : "Find Available Times"}
        </button>
      </form>

      {slots.length > 0 && (
        <div className="slots">
          <h3>Available Slots ({slots.length})</h3>
          <ul>
            {slots.map((s, i) => (
              <li key={i}>
                {new Date(s.start).toLocaleString()} –{" "}
                {new Date(s.end).toLocaleTimeString()}
              </li>
            ))}
          </ul>
          <button className="btn primary" onClick={sendProposals} disabled={loading}>
            {loading ? "Sending…" : "Send Proposal Email"}
          </button>
        </div>
      )}

      {message && <div className="message success">{message}</div>}
    </div>
  );
}