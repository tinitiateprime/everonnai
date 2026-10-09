"use client";

import { useEffect, useState } from "react";
import { authorityCapabilities, type ClientDirectoryEntry } from "@/features/call-center/types";
import { fetchDeskJson } from "./desk-api";
import { channelLabel, formatNumber, humanize, languageLabel } from "./format";

// Granted clients only: scripts, notes, authority, hours and lines.
export function ClientDirectory() {
  const [clients, setClients] = useState<ClientDirectoryEntry[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    fetchDeskJson<{ clients: ClientDirectoryEntry[] }>("/api/call-center/directory")
      .then((data) => { if (active) setClients(data.clients); })
      .catch((caught: Error) => { if (active) setError(caught.message); });
    return () => { active = false; };
  }, []);
  if (error) return <p className="desk-alert" role="alert">{error}</p>;
  if (!clients) return <p className="desk-empty" role="status">Loading your clients…</p>;
  if (!clients.length) return <p className="desk-empty">You are not certified for any clients yet. Ask your operator lead for a grant.</p>;
  return (
    <div className="desk-directory">
      {clients.map((client) => (
        <article key={client.tenantId} className="desk-card" style={{ "--client-color": client.brandColor } as React.CSSProperties}>
          <header className="desk-directory-head"><i className="desk-chip" /><div><h2>{client.name}</h2><small>{client.status === "open" ? "Open now" : "After hours"} · {client.timeZone}{client.pronunciation ? ` · say “${client.pronunciation}”` : ""}</small></div></header>
          {client.operatorNotes && <p className="desk-owner-note">{client.operatorNotes}</p>}
          <h3>Greetings</h3>
          <ul className="desk-greetings">{client.greetings.map((greeting) => <li key={`${greeting.language}-${greeting.hoursMode}`}><span>{languageLabel(greeting.language)} · {humanize(greeting.hoursMode)} · v{greeting.version}</span>“{greeting.text}”</li>)}</ul>
          <h3>Authority</h3>
          <ul className="desk-authority-summary">{authorityCapabilities.map(([key, label]) => { const level = client.authority[key] || "not_allowed"; return <li key={key} className={`is-${level}`}><span>{label}</span><b>{level === "allowed" ? "yes" : level === "not_allowed" ? "no" : "owner approval"}</b></li>; })}</ul>
          <h3>Business</h3>
          <dl><dt>Hours</dt><dd>{client.business.hours || "—"}</dd><dt>Services</dt><dd>{client.business.services.join(", ")}</dd><dt>Area</dt><dd>{client.business.serviceArea || "—"}</dd><dt>Pricing</dt><dd>{client.business.pricingPolicy || "—"}</dd></dl>
          <h3>Lines</h3>
          <ul>{client.lines.map((line) => <li key={`${line.label}-${line.kind}`}>{line.label} · {channelLabel[line.kind]}{line.numberE164 ? ` · ${formatNumber(line.numberE164)}` : ""}</li>)}</ul>
        </article>
      ))}
    </div>
  );
}
