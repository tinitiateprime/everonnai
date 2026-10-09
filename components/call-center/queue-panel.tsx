"use client";

import { useState } from "react";
import type { DeskCommandType, QueueItem } from "@/features/call-center/types";
import { channelLabel, countdown, duration, languageLabel, severityLabel } from "./format";

type Run = (type: DeskCommandType, payload?: Record<string, unknown>) => Promise<Record<string, unknown> | null>;

// DSK-001 unified multi-client queue with client chips, deadlines and filters.
export function QueuePanel({ items, now, busy, run, compact = false }: { items: QueueItem[]; now: number; busy: boolean; run: Run; compact?: boolean }) {
  const [client, setClient] = useState("");
  const [channel, setChannel] = useState("");
  const [severity, setSeverity] = useState("");
  const [language, setLanguage] = useState("");
  const clients = [...new Set(items.map((item) => item.clientName))].sort();
  const visible = items.filter((item) => (!client || item.clientName === client) && (!channel || item.channel === channel) && (!severity || String(item.severity) === severity) && (!language || item.language === language));
  if (compact) {
    return (
      <div className="desk-queue-strip" aria-label="Queue">
        <b>Queue: {items.length} waiting</b>
        {items.slice(0, 6).map((item) => <span key={item.key} style={{ "--client-color": item.brandColor } as React.CSSProperties}><i className="desk-chip" />{item.clientName} ({severityLabel[item.severity].split(" ")[0]}) {duration(item.waitingSince, now)}</span>)}
      </div>
    );
  }
  return (
    <section className="desk-queue" aria-label="Queue">
      <header>
        <h2>Queue <small>{items.length}</small></h2>
        <div className="desk-filters">
          <select aria-label="Filter by client" value={client} onChange={(event) => setClient(event.target.value)}><option value="">All clients</option>{clients.map((name) => <option key={name}>{name}</option>)}</select>
          <select aria-label="Filter by channel" value={channel} onChange={(event) => setChannel(event.target.value)}><option value="">All channels</option><option value="voice">Calls</option><option value="chat">Chats</option><option value="sms">Texts</option><option value="callback">Callbacks</option></select>
          <select aria-label="Filter by severity" value={severity} onChange={(event) => setSeverity(event.target.value)}><option value="">All severities</option>{[1, 2, 3, 4].map((value) => <option key={value} value={value}>P{value}</option>)}</select>
          <select aria-label="Filter by language" value={language} onChange={(event) => setLanguage(event.target.value)}><option value="">All languages</option><option value="en">English</option><option value="es">Spanish</option></select>
        </div>
      </header>
      {visible.length === 0 ? <p className="desk-empty">Nothing waiting for your clients.</p> : (
        <ul>
          {visible.map((item) => {
            const due = countdown(item.dueAt, now);
            return (
              <li key={item.key} className={`kind-${item.kind}`} style={{ "--client-color": item.brandColor } as React.CSSProperties}>
                <i className="desk-chip" aria-hidden="true" />
                <div className="desk-queue-main">
                  <strong>{item.clientName}</strong>
                  <span>{item.lineLabel} · {channelLabel[item.channel]} · {languageLabel(item.language)}</span>
                  <small>{item.detail}</small>
                </div>
                <span className={`desk-severity sev-${item.severity}`}>{severityLabel[item.severity]}</span>
                <div className="desk-queue-times">
                  <span>waiting {duration(item.waitingSince, now)}</span>
                  {item.kind !== "unknown_line" && item.kind !== "approval" && <span className={due.overdue ? "is-overdue" : ""}>SLA {due.label}</span>}
                  <small>{item.status}</small>
                </div>
                {item.kind === "callback" && <button className="desk-primary" disabled={busy} onClick={() => void run("callback.start", { task_id: item.taskId, tenant_id: item.tenantId })}>Start callback</button>}
                {item.kind === "unknown_line" && <button className="desk-ghost" disabled={busy} onClick={() => void run("incident.acknowledge", { incident_id: item.incidentId })}>Acknowledge incident</button>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
