import { useSession, signIn, signOut } from "next-auth/react";
import { useState } from "react";

export default function Home() {
  const { data: session } = useSession();
  const [form, setForm] = useState({ email: "", duration: 30, subject: "", notes: "" });
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  if (!session) {
    return <button onClick={() => signIn("google")}>Sign in with Google</button>;
  }

  const findSlots = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch("/api/find-slots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: session.user.accessToken,
          refreshToken: session.user.refreshToken,
          duration: form.duration,
        }),
      });
      const data = await res.json();
      console.log("Fetched slots:", data.slots);
      setSlots(data.slots || []);
    } catch (err) {
      console.error("Error fetching slots:", err);
      setMessage("Error fetching slots. Check console.");
    } finally {
      setLoading(false);
    }
  };

  const sendProposals = async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch("/api/send-proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: session.user.accessToken,
          refreshToken: session.user.refreshToken,
          email: form.email,
          subject: form.subject,
          notes: form.notes,
          slots,
        }),
      });
      const text = await res.text();
      if (!res.ok) {
        console.error("Error sending proposal, response text:", text);
        setMessage(`Error ${res.status}: ${res.statusText}`);
      } else {
        let data;
        try {
          data = JSON.parse(text);
        } catch (parseErr) {
          console.error("Error parsing JSON response:", parseErr, text);
          setMessage("Invalid JSON response; check console.");
          return;
        }
        console.log("Send proposals response:", data);
        setMessage(data.message || "Proposal sent!");
      }
    } catch (err) {
      console.error("Error sending proposal:", err);
      setMessage("Error sending proposal. Check console.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <button onClick={() => signOut()}>Sign out</button>
      <form onSubmit={findSlots} style={{ marginBottom: 20 }}>
        <div>
          <label>Attendee Email:</label>
          <input
            type="email"
            placeholder="Attendee email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </div>
        <div>
          <label>Duration (mins):</label>
          <input
            type="number"
            min="5"
            max="120"
            step="5"
            required
            value={form.duration}
            onChange={(e) => setForm({ ...form, duration: +e.target.value })}
          />
        </div>
        <div>
          <label>Subject:</label>
          <input
            type="text"
            placeholder="Subject"
            required
            value={form.subject}
            onChange={(e) => setForm({ ...form, subject: e.target.value })}
          />
        </div>
        <div>
          <label>Notes:</label>
          <textarea
            placeholder="Notes"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>
        <button type="submit" disabled={loading}>
          {loading ? "Finding…" : "Find Available Times"}
        </button>
      </form>

      {slots.length > 0 && (
        <div>
          <h3>Available Slots ({slots.length}):</h3>
          <ul>
            {slots.map((s, i) => (
              <li key={i}>
                {new Date(s.start).toLocaleString()} – {new Date(s.end).toLocaleTimeString()}
              </li>
            ))}
          </ul>
          <button onClick={sendProposals} disabled={loading}>
            {loading ? "Sending…" : "Send Proposal Email"}
          </button>
        </div>
      )}

      {message && <p>{message}</p>}
    </div>
  );
}