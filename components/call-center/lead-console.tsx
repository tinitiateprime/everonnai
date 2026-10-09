"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import type { DeskCommandType, RosterData, WallboardData } from "@/features/call-center/types";
import { fetchDeskJson } from "./desk-api";
import { channelLabel, duration, formatNumber, humanize } from "./format";

type Run = (type: DeskCommandType, payload?: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
type Wallboard = WallboardData & { scenarios: Array<{ key: string; label: string }> };

const percent = (value: number | null) => value === null ? "—" : `${Math.round(value * 1000) / 10}%`;

// Operator-lead tools: wall board (DSK-020), approvals (HIL-007), quality
// review (HIL-009), roster and grants (DSK-002), and the demo simulator.
export function LeadConsole({ now, busy, run, view }: { now: number; busy: boolean; run: Run; view: "wallboard" | "roster" | "quality" }) {
  const [board, setBoard] = useState<Wallboard | null>(null);
  const [roster, setRoster] = useState<RosterData | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [nextBoard, nextRoster] = await Promise.all([fetchDeskJson<Wallboard>("/api/call-center/wallboard"), fetchDeskJson<RosterData>("/api/call-center/roster")]);
      setBoard(nextBoard);
      setRoster(nextRoster);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The wall board is unavailable.");
    }
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    const tick = async () => {
      await refresh();
      if (!stopped) timer = window.setTimeout(tick, 4000);
    };
    void tick();
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [refresh]);

  const act: Run = async (type, payload) => {
    const result = await run(type, payload);
    await refresh();
    return result;
  };

  if (error) return <p className="desk-alert" role="alert">{error}</p>;
  if (!board || !roster) return <p className="desk-empty" role="status">Loading the operations view…</p>;
  if (view === "roster") return <Roster roster={roster} busy={busy} run={act} />;
  if (view === "quality") return <Quality board={board} busy={busy} run={act} />;
  return (
    <div className="desk-lead">
      <section className="desk-kpis" aria-label="Service levels today">
        <article><span>Waiting now</span><strong>{board.totals.waiting}</strong></article>
        <article><span>Active interactions</span><strong>{board.totals.active}</strong></article>
        <article><span>Handled today</span><strong>{board.totals.handledToday}</strong></article>
        <article><span>Urgent answered ≤ 20 s</span><strong>{percent(board.totals.serviceLevel)}</strong></article>
        <article><span>Abandon rate</span><strong>{percent(board.totals.abandonRate)}</strong></article>
        <article className={board.totals.wrongClientRate && board.totals.wrongClientRate > 0.001 ? "is-alert" : ""}><span>Wrong-client rate</span><strong>{percent(board.totals.wrongClientRate)}</strong></article>
      </section>
      <div className="desk-lead-grid">
        <section className="desk-card">
          <h2>Queues by client</h2>
          <table className="desk-table">
            <thead><tr><th>Client</th><th>Waiting</th><th>Urgent</th><th>Longest wait</th><th>Breached</th><th>Active</th></tr></thead>
            <tbody>{board.clients.map((client) => (
              <tr key={client.tenantId} className={client.breached ? "is-alert" : ""}>
                <td style={{ "--client-color": client.brandColor } as React.CSSProperties}><i className="desk-chip" /> {client.name}</td>
                <td>{client.waiting}</td><td>{client.urgentWaiting}</td><td>{client.oldestWaitingSince ? duration(client.oldestWaitingSince, now) : "—"}</td><td>{client.breached}</td><td>{client.activeHandlings}</td>
              </tr>
            ))}</tbody>
          </table>
        </section>
        <section className="desk-card">
          <h2>Operators</h2>
          <table className="desk-table">
            <thead><tr><th>Operator</th><th>Status</th><th>For</th><th>Working on</th></tr></thead>
            <tbody>{board.operators.map((operator) => (
              <tr key={operator.operatorId}>
                <td>{operator.name}{operator.role === "operator_lead" && <small> lead</small>}<small> {operator.languages.join("/").toUpperCase()}</small></td>
                <td><span className={`desk-presence presence-${operator.presence}`}>{humanize(operator.presence)}</span></td>
                <td>{duration(operator.since, now)}</td>
                <td>{operator.activeClients.join(", ") || "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      </div>
      <Approvals board={board} busy={busy} run={act} />
      <Simulator board={board} roster={roster} busy={busy} run={act} />
    </div>
  );
}

function Approvals({ board, busy, run }: { board: Wallboard; busy: boolean; run: Run }) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  if (!board.approvals.length) return null;
  return (
    <section className="desk-card">
      <h2>Owner approvals waiting</h2>
      <p className="desk-muted">Normally decided by the client owner. Record the owner&apos;s decision here only when they gave it to you directly.</p>
      <ul className="desk-approvals">
        {board.approvals.map((approval) => (
          <li key={approval.id}>
            <div><strong>{approval.clientName}</strong> · {humanize(approval.capability)} · requested by {approval.requestedBy}<p>{approval.detail}</p></div>
            <input aria-label="Decision note" placeholder="e.g. Approved by Alex Kim by phone" value={notes[approval.id] || ""} onChange={(event) => setNotes({ ...notes, [approval.id]: event.target.value })} />
            <button className="desk-primary" disabled={busy || !notes[approval.id]?.trim()} onClick={() => void run("approval.decide", { approval_id: approval.id, tenant_id: approval.tenantId, decision: "approved", note: notes[approval.id] })}>Approve</button>
            <button className="desk-ghost" disabled={busy || !notes[approval.id]?.trim()} onClick={() => void run("approval.decide", { approval_id: approval.id, tenant_id: approval.tenantId, decision: "rejected", note: notes[approval.id] })}>Reject</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Simulator({ board, roster, busy, run }: { board: Wallboard; roster: RosterData; busy: boolean; run: Run }) {
  const [scenario, setScenario] = useState(board.scenarios[0]?.key || "");
  const [tenantId, setTenantId] = useState("");
  const [channel, setChannel] = useState("voice");
  const [unknownLine, setUnknownLine] = useState(false);
  const [result, setResult] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const response = await run("simulate.inbound", { scenario, tenant_id: tenantId || undefined, channel, unknown_line: unknownLine });
    if (response) setResult(response.status === "unknown_line" ? "Created an UNKNOWN LINE incident." : `Escalation created (${String(response.routing || "queued").replaceAll("_", " ")}).`);
  }
  return (
    <section className="desk-card desk-simulator">
      <h2>Demo intake <small>simulation</small></h2>
      <p className="desk-muted">Telephony and the AI runtime are not connected yet. This sends a realistic escalation through the same intake path the runtime will use (<code>POST /api/call-center/intake</code>).</p>
      <form onSubmit={(event) => void submit(event)}>
        <label>Scenario<select value={scenario} onChange={(event) => setScenario(event.target.value)}>{board.scenarios.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
        <label>Client<select value={tenantId} onChange={(event) => setTenantId(event.target.value)} disabled={unknownLine}><option value="">Any client</option>{roster.clients.map((client) => <option key={client.tenantId} value={client.tenantId}>{client.name}</option>)}</select></label>
        <label>Channel<select value={channel} onChange={(event) => setChannel(event.target.value)} disabled={unknownLine}><option value="voice">{channelLabel.voice}</option><option value="chat">{channelLabel.chat}</option><option value="sms">{channelLabel.sms}</option></select></label>
        <label className="desk-check"><input type="checkbox" checked={unknownLine} onChange={(event) => setUnknownLine(event.target.checked)} /> Unknown dialed number</label>
        <button className="desk-primary" disabled={busy}>Send test escalation</button>
      </form>
      {result && <p role="status" className="desk-muted">{result}</p>}
    </section>
  );
}

function Quality({ board, busy, run }: { board: Wallboard; busy: boolean; run: Run }) {
  const [open, setOpen] = useState<string | null>(null);
  const [scores, setScores] = useState({ accuracy: 4, safety: 5, tone: 4, outcome: 4 });
  const [greetingCorrect, setGreetingCorrect] = useState(true);
  const [wrongClient, setWrongClient] = useState(false);
  const [notes, setNotes] = useState("");
  const target = board.reviewable.find((item) => item.handlingId === open);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!target) return;
    if (await run("qa.submit", { handling_id: target.handlingId, tenant_id: target.tenantId, scores, greeting_correct: greetingCorrect, wrong_client: wrongClient, notes })) {
      setOpen(null);
      setNotes("");
      setWrongClient(false);
    }
  }
  return (
    <section className="desk-card">
      <h2>Quality review</h2>
      <table className="desk-table">
        <thead><tr><th>Client</th><th>Operator</th><th>Channel</th><th>Disposition</th><th>Greeting</th><th></th></tr></thead>
        <tbody>{board.reviewable.map((item) => (
          <tr key={item.handlingId}>
            <td>{item.clientName}</td><td>{item.operatorName}</td><td>{channelLabel[item.channel]}</td><td>{item.disposition ? humanize(item.disposition) : "—"}</td>
            <td>{item.greetingDelivered ? "Delivered" : "Not marked"}</td>
            <td>{item.reviewed ? "Reviewed" : <button className="desk-link" onClick={() => setOpen(item.handlingId)}>Review</button>}</td>
          </tr>
        ))}</tbody>
      </table>
      {board.reviewable.length === 0 && <p className="desk-empty">Completed interactions appear here for review.</p>}
      {target && (
        <form className="desk-inline-form desk-qa" onSubmit={(event) => void submit(event)}>
          <h3>Review {target.operatorName} · {target.clientName}</h3>
          {(["accuracy", "safety", "tone", "outcome"] as const).map((key) => (
            <label key={key}>{humanize(key)}<input type="range" min={1} max={5} value={scores[key]} onChange={(event) => setScores({ ...scores, [key]: Number(event.target.value) })} /><output>{scores[key]}</output></label>
          ))}
          <label className="desk-check"><input type="checkbox" checked={greetingCorrect} onChange={(event) => setGreetingCorrect(event.target.checked)} /> Greeted in the correct client&apos;s name</label>
          <label className="desk-check"><input type="checkbox" checked={wrongClient} onChange={(event) => setWrongClient(event.target.checked)} /> Wrong-client incident</label>
          <label>Notes<textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
          <button className="desk-primary" disabled={busy}>Save review</button>
          <button type="button" className="desk-link" onClick={() => setOpen(null)}>Cancel</button>
        </form>
      )}
    </section>
  );
}

function Roster({ roster, busy, run }: { roster: RosterData; busy: boolean; run: Run }) {
  const grantFor = (operatorId: string, tenantId: string) => roster.grants.find((grant) => grant.operatorId === operatorId && grant.tenantId === tenantId);
  return (
    <div className="desk-lead">
      <section className="desk-card">
        <h2>Client roster and grants</h2>
        <p className="desk-muted">A grant is required both for routing and for seeing client data. Certification requires the client-specific training to be recorded first. Revocation moves the operator out of open interactions immediately.</p>
        <div className="desk-table-wrap">
          <table className="desk-table desk-roster">
            <thead><tr><th>Operator</th>{roster.clients.map((client) => <th key={client.tenantId} style={{ "--client-color": client.brandColor } as React.CSSProperties}><i className="desk-chip" /> {client.name}</th>)}</tr></thead>
            <tbody>{roster.operators.map((operator) => (
              <tr key={operator.operatorId}>
                <td><strong>{operator.name}</strong><small>{operator.email} · {operator.role === "operator_lead" ? "lead" : "operator"} · {operator.languages.join("/").toUpperCase()}</small></td>
                {roster.clients.map((client) => {
                  const grant = grantFor(operator.operatorId, client.tenantId);
                  const payload = { operator_id: operator.operatorId, tenant_id: client.tenantId, skills: operator.languages };
                  return (
                    <td key={client.tenantId}>
                      {grant?.active ? <span className="desk-grant is-active">Certified</span> : grant?.revokedAt ? <span className="desk-grant">Revoked</span> : grant?.trainingCompletedAt ? <span className="desk-grant">Trained</span> : <span className="desk-grant">No access</span>}
                      <div className="desk-grant-actions">
                        {!grant?.active && !grant?.trainingCompletedAt && <button className="desk-link" disabled={busy} onClick={() => void run("grant.upsert", { ...payload, training_completed: true, certify: false })}>Record training</button>}
                        {!grant?.active && (grant?.trainingCompletedAt || grant?.revokedAt) && <button className="desk-link" disabled={busy} onClick={() => void run("grant.upsert", { ...payload, training_completed: true, certify: true })}>Certify &amp; grant</button>}
                        {grant?.active && <button className="desk-link is-danger" disabled={busy} onClick={() => void run("grant.revoke", { operator_id: operator.operatorId, tenant_id: client.tenantId })}>Revoke</button>}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>
      <section className="desk-card">
        <h2>Lines</h2>
        <table className="desk-table">
          <thead><tr><th>Client</th><th>Line</th><th>Channel</th><th>Number</th></tr></thead>
          <tbody>{roster.clients.flatMap((client) => client.lines.map((line) => <tr key={line.lineId}><td>{client.name}</td><td>{line.label}</td><td>{channelLabel[line.kind]}</td><td>{formatNumber(line.numberE164) || "Website widget"}</td></tr>))}</tbody>
        </table>
      </section>
    </div>
  );
}
