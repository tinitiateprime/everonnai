"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { authorityCapabilities, dispositions, type ActiveInteraction, type AuthorityCapability, type DeskCommandType, type Disposition } from "@/features/call-center/types";
import { AuthoritySummary, CapturedList, ClientBanner } from "./offer-card";
import { countdown, duration, formatClock, humanize, languageLabel, severityLabel } from "./format";

type Run = (type: DeskCommandType, payload?: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
type Panel = "transfer" | "handback" | "callback" | "wrong_client" | null;

export function InteractionWorkspace({ interaction, now, busy, run }: { interaction: ActiveInteraction; now: number; busy: boolean; run: Run }) {
  const base = { handling_id: interaction.handlingId, tenant_id: interaction.client.tenantId };
  const command = (type: DeskCommandType, payload: Record<string, unknown> = {}) => run(type, { ...base, ...payload });
  const voice = interaction.channel === "voice" || interaction.channel === "callback";
  const live = ["connecting", "active", "on_hold"].includes(interaction.state);
  const [panel, setPanel] = useState<Panel>(null);

  // Voice: the operator hears the private announcement, then the caller is
  // bridged (DSK-005). Without a media layer the bridge is a state change.
  const connectRequested = useRef(false);
  useEffect(() => {
    if (interaction.state !== "connecting" || connectRequested.current) return;
    const timer = window.setTimeout(() => {
      connectRequested.current = true;
      void run("call.connected", { handling_id: interaction.handlingId, tenant_id: interaction.client.tenantId });
    }, interaction.announcement.enabled ? 2500 : 600);
    return () => window.clearTimeout(timer);
  }, [interaction.state, interaction.announcement.enabled, interaction.handlingId, interaction.client.tenantId, run]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.closest("input, textarea, select, [contenteditable=true]") || event.metaKey || event.ctrlKey || event.altKey)) return;
      const key = event.key.toLowerCase();
      if (key === "g" && !interaction.greetingDelivered && live) { event.preventDefault(); void run("greeting.delivered", { handling_id: interaction.handlingId, tenant_id: interaction.client.tenantId }); }
      if (key === "h" && voice && (interaction.state === "active" || interaction.state === "on_hold")) { event.preventDefault(); void run(interaction.state === "on_hold" ? "call.resume" : "call.hold", { handling_id: interaction.handlingId, tenant_id: interaction.client.tenantId }); }
      if (key === "m" && voice && live) { event.preventDefault(); void run("call.mute", { handling_id: interaction.handlingId, tenant_id: interaction.client.tenantId, muted: !interaction.muted }); }
      if (key === "t" && voice && live) { event.preventDefault(); setPanel("transfer"); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [interaction.greetingDelivered, interaction.state, interaction.muted, interaction.handlingId, interaction.client.tenantId, live, voice, run]);

  const talkFrom = interaction.connectedAt || interaction.acceptedAt;
  return (
    <section className="desk-workspace" aria-label={`Active interaction for ${interaction.client.name}`}>
      <ClientBanner context={interaction} compact>
        <div className="desk-banner-meta">
          <span className={`desk-state state-${interaction.state}`}>{humanize(interaction.state)}</span>
          <span>{severityLabel[interaction.escalation.severity]}</span>
          <span>{interaction.state === "wrap_up" ? "Wrap-up" : duration(talkFrom, now)}</span>
          {voice && <span className="desk-recording">● recording per client policy</span>}
          <span>Caller: {interaction.caller.name || "Unknown"} · {languageLabel(interaction.caller.language)}</span>
        </div>
      </ClientBanner>

      {interaction.state === "connecting" && (
        <div className="desk-announcement" role="status">
          {interaction.channel === "callback"
            ? <p><b>Calling back</b> from {interaction.client.name}&apos;s business number ({interaction.line.numberE164 || "line"}) as caller ID…</p>
            : <p><b>Operator-only announcement</b> (caller cannot hear): “{interaction.announcement.text}”</p>}
          <p className="desk-muted">The caller hears: “One moment, I&apos;m connecting you to a team member at {interaction.client.spokenName}.” Connecting…</p>
        </div>
      )}

      {live && (
        <div className={`desk-say-this ${interaction.greetingDelivered ? "is-done" : ""}`}>
          <span>Say this</span>
          <p>“{interaction.greeting.text}”</p>
          {interaction.greetingDelivered
            ? <small>Greeting delivered ✓</small>
            : <button className="desk-primary" onClick={() => void command("greeting.delivered")} disabled={busy} aria-keyshortcuts="G">Greeting delivered <kbd>G</kbd></button>}
        </div>
      )}

      {live && (
        <div className="desk-controls" role="toolbar" aria-label="Interaction controls">
          {voice && (interaction.state === "on_hold"
            ? <button onClick={() => void command("call.resume")} disabled={busy} aria-keyshortcuts="H">Resume <kbd>H</kbd></button>
            : <button onClick={() => void command("call.hold")} disabled={busy || interaction.state !== "active"} aria-keyshortcuts="H">Hold <kbd>H</kbd></button>)}
          {voice && <button onClick={() => void command("call.mute", { muted: !interaction.muted })} disabled={busy} aria-pressed={interaction.muted} aria-keyshortcuts="M">{interaction.muted ? "Unmute" : "Mute"} <kbd>M</kbd></button>}
          {voice && <button onClick={() => setPanel(panel === "transfer" ? null : "transfer")} disabled={busy || interaction.state === "connecting"} aria-keyshortcuts="T">Transfer <kbd>T</kbd></button>}
          <button onClick={() => setPanel(panel === "handback" ? null : "handback")} disabled={busy}>Hand back to AI</button>
          <button onClick={() => setPanel(panel === "callback" ? null : "callback")} disabled={busy}>Schedule callback</button>
          <button className="desk-end" onClick={() => void command("call.end")} disabled={busy}>{voice ? "End call" : "Release chat"}</button>
          <button className="desk-wrong-client" onClick={() => setPanel(panel === "wrong_client" ? null : "wrong_client")} disabled={busy}>Wrong client</button>
        </div>
      )}

      {panel === "transfer" && <TransferPanel interaction={interaction} busy={busy} onSubmit={async (payload) => { if (await command("call.transfer", payload)) setPanel(null); }} />}
      {panel === "handback" && <SimpleForm label="Instruction for the AI" placeholder="e.g. Confirm the booking for 9 PM and send the arrival text." submit="Hand back to AI" busy={busy} onSubmit={async (value) => { if (await command("call.handback", { instruction: value })) setPanel(null); }} />}
      {panel === "callback" && <CallbackPanel busy={busy} onSubmit={async (payload) => { if (await command("callback.schedule", payload)) setPanel(null); }} />}
      {panel === "wrong_client" && <SimpleForm label={`Report that this is not ${interaction.client.name}. The interaction is logged and re-routed.`} placeholder="What told you this was the wrong client?" submit="Report wrong client" danger busy={busy} onSubmit={async (value) => { if (await command("wrongclient.report", { notes: value })) setPanel(null); }} />}

      {interaction.state === "wrap_up" && <WrapUp interaction={interaction} now={now} busy={busy} onSubmit={(payload) => command("wrapup.submit", payload)} />}

      <div className="desk-columns">
        <Conversation interaction={interaction} busy={busy} onReply={(text) => command("chat.reply", { text })} />
        {interaction.request && <RequestEditor key={`${interaction.request.id}:${interaction.request.version}`} interaction={interaction} busy={busy} onSave={(payload) => command("request.update", payload)} />}
        <ClientContext interaction={interaction} busy={busy} onAct={(capability, detail) => command("authority.act", { capability, detail })} />
      </div>
    </section>
  );
}

function SimpleForm({ label, placeholder, submit, busy, danger = false, onSubmit }: { label: string; placeholder: string; submit: string; busy: boolean; danger?: boolean; onSubmit: (value: string) => Promise<void> }) {
  const [value, setValue] = useState("");
  return (
    <form className="desk-inline-form" onSubmit={(event) => { event.preventDefault(); void onSubmit(value); }}>
      <label>{label}<textarea required rows={2} value={value} placeholder={placeholder} onChange={(event) => setValue(event.target.value)} /></label>
      <button className={danger ? "desk-danger" : "desk-primary"} disabled={busy || !value.trim()}>{submit}</button>
    </form>
  );
}

function TransferPanel({ interaction, busy, onSubmit }: { interaction: ActiveInteraction; busy: boolean; onSubmit: (payload: Record<string, unknown>) => Promise<void> }) {
  const [contactId, setContactId] = useState(interaction.transferContacts.find((contact) => contact.onCall)?.id || interaction.transferContacts[0]?.id || "");
  const [mode, setMode] = useState<"warm" | "cold">("warm");
  const captured = interaction.ai.captured.filter((field) => field.value).map((field) => `${field.label || humanize(field.field)}: ${field.value}`).join("; ");
  const [briefing, setBriefing] = useState(`${interaction.caller.name || "Caller"} — ${interaction.ai.summary || humanize(interaction.escalation.trigger)}${captured ? ` (${captured})` : ""}`);
  if (!interaction.transferContacts.length) return <p className="desk-inline-form">This client has no transfer contacts. Take a message or schedule a callback.</p>;
  return (
    <form className="desk-inline-form" onSubmit={(event) => { event.preventDefault(); void onSubmit({ contact_id: contactId, mode, briefing }); }}>
      <label>Transfer to<select value={contactId} onChange={(event) => setContactId(event.target.value)}>{interaction.transferContacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name} · {contact.role} · {contact.maskedNumber}{contact.onCall ? " · on call" : ""}</option>)}</select></label>
      <fieldset><legend>Type</legend><label><input type="radio" checked={mode === "warm"} onChange={() => setMode("warm")} /> Warm (whispered briefing)</label><label><input type="radio" checked={mode === "cold"} onChange={() => setMode("cold")} /> Cold</label></fieldset>
      <label>Briefing<textarea rows={2} value={briefing} onChange={(event) => setBriefing(event.target.value)} required={mode === "warm"} /></label>
      <button className="desk-primary" disabled={busy || !contactId}>Transfer call</button>
    </form>
  );
}

function CallbackPanel({ busy, onSubmit }: { busy: boolean; onSubmit: (payload: Record<string, unknown>) => Promise<void> }) {
  const [due, setDue] = useState("");
  const [notes, setNotes] = useState("");
  return (
    <form className="desk-inline-form" onSubmit={(event) => { event.preventDefault(); void onSubmit({ due_at: new Date(due).toISOString(), notes }); }}>
      <label>Call back at (your local time)<input type="datetime-local" required value={due} onChange={(event) => setDue(event.target.value)} /></label>
      <label>Notes<input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="What the caller is expecting" /></label>
      <button className="desk-primary" disabled={busy || !due}>Schedule callback</button>
    </form>
  );
}

function Conversation({ interaction, busy, onReply }: { interaction: ActiveInteraction; busy: boolean; onReply: (text: string) => Promise<Record<string, unknown> | null> }) {
  const [reply, setReply] = useState("");
  const listRef = useRef<HTMLOListElement>(null);
  const textThread = interaction.channel === "chat" || interaction.channel === "sms";
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [interaction.transcript.length]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await onReply(reply)) setReply("");
  }
  return (
    <section className="desk-column" aria-label="Conversation">
      <h3>Conversation <small>{interaction.channel === "sms" ? "Text thread" : interaction.channel === "chat" ? "Website chat" : "Live transcript"}</small></h3>
      <ol className="desk-transcript" ref={listRef} aria-live="polite">
        {interaction.transcript.map((turn) => <li key={turn.id} className={`from-${turn.speaker}`}><span>{turn.speaker === "ai" ? "AI" : turn.speaker} · {formatClock(turn.at)}</span>{turn.text}</li>)}
      </ol>
      {textThread && interaction.state === "active" && (
        <form className="desk-reply" onSubmit={(event) => void submit(event)}>
          {interaction.cannedReplies.length > 0 && <select aria-label="Canned replies" value="" onChange={(event) => setReply(event.target.value)}><option value="">Canned replies…</option>{interaction.cannedReplies.map((text) => <option key={text} value={text}>{text}</option>)}</select>}
          <textarea rows={2} value={reply} onChange={(event) => setReply(event.target.value)} placeholder={`Reply as ${interaction.client.name}`} aria-label="Reply" />
          <button className="desk-primary" disabled={busy || !reply.trim()}>Send</button>
        </form>
      )}
    </section>
  );
}

function RequestEditor({ interaction, busy, onSave }: { interaction: ActiveInteraction; busy: boolean; onSave: (payload: Record<string, unknown>) => Promise<Record<string, unknown> | null> }) {
  const request = interaction.request!;
  const slots = interaction.playbookSlots.length ? interaction.playbookSlots : request.fields.map((field) => ({ field: field.field, label: field.label || humanize(field.field), required: false }));
  const initial = Object.fromEntries(slots.map((slot) => {
    const field = request.fields.find((item) => item.field === slot.field);
    return [slot.field, { value: field?.value || "", confirmed: Boolean(field?.confirmed && field.value) }];
  }));
  const [values, setValues] = useState(initial);
  const [urgency, setUrgency] = useState(request.urgency);
  const dirty = JSON.stringify(values) !== JSON.stringify(initial) || urgency !== request.urgency;
  const done = slots.filter((slot) => values[slot.field]?.value && values[slot.field]?.confirmed).length;
  function save(event: FormEvent) {
    event.preventDefault();
    const fields = slots.filter((slot) => JSON.stringify(values[slot.field]) !== JSON.stringify(initial[slot.field])).map((slot) => ({ field: slot.field, value: values[slot.field].value || null, confirmed: values[slot.field].confirmed }));
    void onSave({ request_id: request.id, version: request.version, fields, urgency });
  }
  return (
    <section className="desk-column" aria-label="Request">
      <h3>Request <small>v{request.version} · checklist {done}/{slots.length}</small></h3>
      <form className="desk-request" onSubmit={save}>
        <label>Urgency<select value={urgency} onChange={(event) => setUrgency(event.target.value)}><option value="emergency">Emergency</option><option value="urgent">Urgent</option><option value="standard">Standard</option><option value="info">Info only</option></select></label>
        {slots.map((slot) => (
          <div key={slot.field} className="desk-slot">
            <label>{slot.required ? `${slot.label} *` : slot.label}
              <input value={values[slot.field]?.value || ""} onChange={(event) => setValues({ ...values, [slot.field]: { ...values[slot.field], value: event.target.value } })} />
            </label>
            <label className="desk-check"><input type="checkbox" checked={values[slot.field]?.confirmed || false} onChange={(event) => setValues({ ...values, [slot.field]: { ...values[slot.field], confirmed: event.target.checked } })} /> Read back &amp; confirmed</label>
          </div>
        ))}
        <button className="desk-primary" disabled={busy || !dirty}>Save request</button>
      </form>
    </section>
  );
}

function ClientContext({ interaction, busy, onAct }: { interaction: ActiveInteraction; busy: boolean; onAct: (capability: AuthorityCapability, detail: string) => Promise<Record<string, unknown> | null> }) {
  const [acting, setActing] = useState<AuthorityCapability | null>(null);
  const [detail, setDetail] = useState("");
  const [notice, setNotice] = useState("");
  async function act(event: FormEvent) {
    event.preventDefault();
    if (!acting) return;
    const result = await onAct(acting, detail);
    if (result) {
      setNotice(result.outcome === "approval_requested" ? "Owner approval requested. Tell the caller you are confirming with the team." : "Recorded.");
      setActing(null);
      setDetail("");
    }
  }
  return (
    <section className="desk-column desk-context" aria-label={`Client context: ${interaction.client.name}`}>
      <h3 style={{ "--client-color": interaction.client.brandColor } as React.CSSProperties}><i className="desk-chip" /> {interaction.client.name}</h3>
      <details open>
        <summary>Instructions</summary>
        {interaction.instructions.ownerNotes && <p className="desk-owner-note">{interaction.instructions.ownerNotes}</p>}
        <ul>{interaction.instructions.special.map((item) => <li key={item}>{item}</li>)}</ul>
        {interaction.instructions.vipList.length > 0 && <p><b>VIP:</b> {interaction.instructions.vipList.join(", ")}</p>}
        {interaction.instructions.blockedAddresses.length > 0 && <p><b>Blocked addresses:</b> {interaction.instructions.blockedAddresses.join(", ")}</p>}
        {interaction.instructions.doNotSay.length > 0 && <p><b>Do not say:</b> {interaction.instructions.doNotSay.join(", ")}</p>}
      </details>
      <details open>
        <summary>What you may do</summary>
        <AuthoritySummary context={interaction} />
        <div className="desk-authority-actions">
          {authorityCapabilities.filter(([key]) => (interaction.authority[key] || "not_allowed") !== "not_allowed").map(([key, label]) => (
            <button key={key} onClick={() => { setActing(key); setNotice(""); }} disabled={busy}>{label}{interaction.authority[key] === "requires_owner_approval" ? " (ask owner)" : ""}</button>
          ))}
        </div>
        {acting && (
          <form className="desk-inline-form" onSubmit={(event) => void act(event)}>
            <label>{authorityCapabilities.find(([key]) => key === acting)?.[1]} — details<input required value={detail} onChange={(event) => setDetail(event.target.value)} /></label>
            <button className="desk-primary" disabled={busy}>{interaction.authority[acting] === "requires_owner_approval" ? "Request owner approval" : "Record"}</button>
            <button type="button" className="desk-link" onClick={() => setActing(null)}>Cancel</button>
          </form>
        )}
        {notice && <p role="status" className="desk-muted">{notice}</p>}
        {interaction.approvals.map((approval) => <p key={approval.id} className={`desk-approval is-${approval.state}`}>{humanize(approval.capability)}: {approval.state}{approval.decisionNote ? ` — ${approval.decisionNote}` : ""}</p>)}
      </details>
      <details>
        <summary>Business</summary>
        <dl>
          <dt>Hours</dt><dd>{interaction.business.hours || "—"} ({interaction.client.status === "open" ? "open now" : "closed now"})</dd>
          <dt>Services</dt><dd>{interaction.business.services.join(", ") || "—"}</dd>
          <dt>Service area</dt><dd>{interaction.business.serviceArea || "—"}</dd>
          <dt>Pricing</dt><dd>{interaction.business.pricingPolicy || "—"}</dd>
          <dt>Payment</dt><dd>{interaction.business.paymentMethods.join(", ") || "—"}</dd>
        </dl>
      </details>
      <details>
        <summary>Contacts ({interaction.transferContacts.length})</summary>
        <ul>{interaction.transferContacts.map((contact) => <li key={contact.id}>{contact.name} · {contact.role} · {contact.maskedNumber}{contact.onCall ? " · on call" : ""}</li>)}</ul>
        <p className="desk-muted">Numbers are masked; use Transfer to bridge.</p>
      </details>
      <details>
        <summary>Caller history ({interaction.callerHistory.length})</summary>
        {interaction.callerHistory.length ? <ul>{interaction.callerHistory.map((item) => <li key={item.conversationId}>{formatClock(item.startedAt)} · {item.channel} · {item.summary || "No summary"}</li>)}</ul> : <p className="desk-muted">First contact with this client.</p>}
      </details>
      <details>
        <summary>AI captured</summary>
        <CapturedList fields={interaction.ai.captured} />
      </details>
    </section>
  );
}

function WrapUp({ interaction, now, busy, onSubmit }: { interaction: ActiveInteraction; now: number; busy: boolean; onSubmit: (payload: Record<string, unknown>) => Promise<Record<string, unknown> | null> }) {
  const suggested: Disposition = interaction.transferredTo ? "transferred_to_owner" : "resolved";
  const [disposition, setDisposition] = useState<Disposition>(suggested);
  const [clientNotes, setClientNotes] = useState("");
  const [operatorNotes, setOperatorNotes] = useState("");
  const [followUp, setFollowUp] = useState("");
  const remaining = countdown(interaction.wrapDueAt, now);
  const needsClientNotes = interaction.requiredWrapFields.includes("client_notes");
  return (
    <form className="desk-wrapup" onSubmit={(event) => { event.preventDefault(); void onSubmit({ disposition, client_notes: clientNotes, operator_notes: operatorNotes, follow_up: followUp ? { due_at: new Date(followUp).toISOString(), notes: clientNotes } : null }); }}>
      <header><h3>Wrap-up for {interaction.client.name}</h3><span className={remaining.seconds <= 10 ? "is-low" : ""}>Auto-release in {remaining.seconds > 0 ? remaining.label : "0:00"}</span></header>
      <label>Disposition<select value={disposition} onChange={(event) => setDisposition(event.target.value as Disposition)}>{dispositions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Notes for {interaction.client.name}{needsClientNotes && " (required)"}<textarea rows={2} value={clientNotes} required={needsClientNotes} onChange={(event) => setClientNotes(event.target.value)} placeholder="Shown to the client in their inbox" /></label>
      <label>Internal notes<textarea rows={2} value={operatorNotes} onChange={(event) => setOperatorNotes(event.target.value)} /></label>
      <label>Follow-up {disposition === "callback_scheduled" && "(required)"}<input type="datetime-local" value={followUp} required={disposition === "callback_scheduled"} onChange={(event) => setFollowUp(event.target.value)} /></label>
      <button className="desk-primary" disabled={busy}>Complete wrap-up</button>
    </form>
  );
}
