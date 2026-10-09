"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarCheck, Loader2, Unplug } from "lucide-react";

type Activity = {
  id: string;
  kind: "appointment" | "callback" | "handoff";
  createdAt: string;
  callerName: string;
  callerPhone: string;
  service?: string;
  date?: string;
  time?: string;
  timeZone?: string;
  reason?: string;
  email: "sent" | "not_configured" | "failed";
};
type Status = {
  settings: { timeZone: string; durationMinutes: number; notifyEmail: string };
  googleConnected: boolean;
  gmailConnected: boolean;
  calendarReady: boolean;
  connectedAt?: string;
  googleConfigured: boolean;
  redirectUri: string;
  activity: Activity[];
  error?: string;
};
const browserZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "";
  }
};
const zones = (() => {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [];
  }
})();

// Voice/chat booking setup for one generated business: Google Calendar + Gmail via
// OAuth, the business time zone and appointment length, and recent requests.
export function BookingPanel({
  business,
  defaultEmail,
  headers,
}: {
  business: string;
  defaultEmail: string;
  headers: () => Record<string, string>;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [form, setForm] = useState<Status["settings"] | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  // The studio recreates `headers` each render; keep loading stable.
  const headersRef = useRef(headers);
  useEffect(() => {
    headersRef.current = headers;
  }, [headers]);

  const call = useCallback(
    async (body: object) => {
      const response = await fetch("/api/integrations/google", {
        method: "POST",
        headers: headersRef.current(),
        body: JSON.stringify({ business, ...body }),
      });
      const data = await response.json();
      if (!response.ok || data.error)
        throw new Error(data.error ?? "Request failed.");
      return data;
    },
    [business],
  );
  const load = useCallback(async () => {
    try {
      const data = (await call({ action: "status" })) as Status;
      setStatus(data);
      setForm({
        timeZone: data.settings.timeZone || browserZone(),
        durationMinutes: data.settings.durationMinutes || 60,
        notifyEmail: data.settings.notifyEmail || defaultEmail,
      });
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load.");
    }
  }, [call, defaultEmail]);

  useEffect(() => {
    // Google redirects back to /?google=connected|error after consent.
    const query = new URLSearchParams(window.location.search);
    const google = query.get("google");
    if (
      google &&
      (!query.get("business") || query.get("business") === business)
    ) {
      if (google === "connected")
        setMessage("Google connected. Save your booking settings to go live.");
      else setError(query.get("message") ?? "Google connection failed.");
      window.history.replaceState(null, "", window.location.pathname);
    }
    void load();
  }, [business, load]);

  async function run(body: object, done: string) {
    setWorking(true);
    setError("");
    setMessage("");
    try {
      const data = await call(body);
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      setStatus(data);
      setMessage(done);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Request failed.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="panel booking-panel">
      <div className="panel-title">
        <h2>Bookings &amp; calendar</h2>
        <span
          className={`booking-state ${status?.calendarReady ? "live" : ""}`}
        >
          {status?.calendarReady
            ? "Voice booking is live"
            : "Voice booking is off"}
        </span>
      </div>
      <p className="help-text">
        Connect the business&apos;s Google account so the voice and chat
        assistant on this website can check Google Calendar, book confirmed
        appointments and email new bookings and callback requests through Gmail.
      </p>
      {status && !status.googleConfigured && (
        <p className="booking-note">
          Google is not configured on this server. Add GOOGLE_OAUTH_CLIENT_ID,
          GOOGLE_OAUTH_CLIENT_SECRET and CREDENTIAL_ENCRYPTION_KEY (32+
          characters) to .env.local, register <code>{status.redirectUri}</code>{" "}
          as an authorized redirect URI, and restart the app.
        </p>
      )}
      <div className="booking-connect">
        {status?.googleConnected ? (
          <>
            <span>
              <CalendarCheck size={15} /> Google connected
              {status.connectedAt
                ? ` on ${new Date(status.connectedAt).toLocaleDateString()}`
                : ""}
              {status.gmailConnected ? " · Calendar and Gmail" : " · Calendar"}
            </span>
            <button
              className="secondary-button"
              disabled={working}
              onClick={() =>
                void run({ action: "disconnect" }, "Google disconnected.")
              }
            >
              <Unplug size={14} />
              Disconnect
            </button>
          </>
        ) : (
          <button
            className="primary-button"
            disabled={working || !status?.googleConfigured}
            onClick={() => void run({ action: "connect" }, "")}
          >
            <CalendarCheck size={15} />
            Connect Google Calendar &amp; Gmail
          </button>
        )}
      </div>
      {form && (
        <form
          className="booking-settings"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              { action: "save", settings: form },
              "Booking settings saved.",
            );
          }}
        >
          <label className="field">
            <span>Business time zone</span>
            <input
              list="booking-time-zones"
              value={form.timeZone}
              onChange={(event) =>
                setForm({ ...form, timeZone: event.target.value })
              }
              placeholder="e.g. Asia/Kolkata"
            />
            <datalist id="booking-time-zones">
              {zones.map((zone) => (
                <option key={zone} value={zone} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span>Appointment length (minutes)</span>
            <input
              type="number"
              min={5}
              max={480}
              value={form.durationMinutes}
              onChange={(event) =>
                setForm({
                  ...form,
                  durationMinutes: Number(event.target.value),
                })
              }
            />
          </label>
          <label className="field">
            <span>Email bookings and callbacks to</span>
            <input
              type="email"
              value={form.notifyEmail}
              onChange={(event) =>
                setForm({ ...form, notifyEmail: event.target.value })
              }
              placeholder="owner@business.com"
            />
          </label>
          <button className="secondary-button" type="submit" disabled={working}>
            {working && <Loader2 size={14} className="spin" />}
            Save booking settings
          </button>
        </form>
      )}
      {message && <p className="booking-message">{message}</p>}
      {error && <p className="booking-error">{error}</p>}
      {!!status?.activity.length && (
        <details className="change-history" open>
          <summary>Recent requests ({status.activity.length})</summary>
          <ol>
            {status.activity.map((item) => (
              <li key={item.id}>
                <p>
                  <b>
                    {item.kind === "appointment"
                      ? `Booked: ${item.service}, ${item.date} ${item.time} (${item.timeZone})`
                      : item.kind === "handoff"
                        ? "Human follow-up requested"
                        : "Callback request"}
                  </b>{" "}
                  — {item.callerName || "Caller"}, {item.callerPhone}
                  {item.reason ? ` — ${item.reason}` : ""}
                  {item.email === "sent" ? " · emailed" : ""}
                </p>
                <time dateTime={item.createdAt}>
                  {new Date(item.createdAt).toLocaleString()}
                </time>
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
