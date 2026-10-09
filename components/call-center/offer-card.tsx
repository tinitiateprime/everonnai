"use client";

import { useState } from "react";
import { authorityCapabilities, type CapturedField, type InteractionContext, type OfferCard as OfferCardData } from "@/features/call-center/types";
import { countdown, duration, formatNumber, humanize, languageLabel, severityLabel } from "./format";

export function ClientBanner({ context, compact = false, children }: { context: InteractionContext; compact?: boolean; children?: React.ReactNode }) {
  return (
    <div className={`desk-client-banner ${compact ? "is-compact" : ""}`} style={{ "--client-color": context.client.brandColor } as React.CSSProperties}>
      <div>
        <strong>{context.client.name}</strong>
        <span>
          {context.line.label}{context.line.numberE164 ? ` · ${formatNumber(context.line.numberE164)}` : ""} · {context.client.status === "open" ? "Open" : "After hours"}
        </span>
      </div>
      {context.client.pronunciation && <em>Say it: “{context.client.pronunciation}”</em>}
      <small>{context.client.brandName}</small>
      {children}
    </div>
  );
}

export function CapturedList({ fields }: { fields: CapturedField[] }) {
  if (!fields.length) return <p className="desk-muted">Nothing captured yet.</p>;
  return (
    <ul className="desk-captured">
      {fields.map((field) => (
        <li key={field.field} className={field.confirmed && field.value ? "is-confirmed" : "is-unconfirmed"}>
          <span>{field.label || humanize(field.field)}</span>
          <strong>{field.value || "not asked"}</strong>
          <i aria-label={field.confirmed ? "Confirmed" : "Unconfirmed"}>{field.confirmed && field.value ? "ok" : "?"}</i>
          {field.value && field.confidence < 0.9 && <small>{Math.round(field.confidence * 100)}%</small>}
        </li>
      ))}
    </ul>
  );
}

export function AuthoritySummary({ context }: { context: InteractionContext }) {
  return (
    <ul className="desk-authority-summary" aria-label="What you may do for this client">
      {authorityCapabilities.map(([key, label]) => {
        const level = context.authority[key] || "not_allowed";
        return <li key={key} className={`is-${level}`}><span>{label}</span><b>{level === "allowed" ? "yes" : level === "not_allowed" ? "no" : "owner approval"}</b></li>;
      })}
    </ul>
  );
}

// DSK-004 screen-pop: everything needed to greet correctly, with no clicks.
export function OfferCard({ offer, now, busy, onAccept, onDecline }: { offer: OfferCardData; now: number; busy: boolean; onAccept: () => void; onDecline: (reason: string) => void }) {
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("Not ready");
  const [showTranscript, setShowTranscript] = useState(false);
  const remaining = countdown(offer.expiresAt, now);
  return (
    <section className={`desk-offer severity-${offer.escalation.severity}`} role="alertdialog" aria-labelledby={`offer-${offer.offerId}`} aria-describedby={`offer-greeting-${offer.offerId}`}>
      <header>
        <span className="desk-offer-kind">Incoming {offer.escalation.channel === "voice" ? "call" : offer.escalation.channel}</span>
        <span className={`desk-severity sev-${offer.escalation.severity}`}>{severityLabel[offer.escalation.severity]}</span>
        <span>waiting {duration(offer.escalation.createdAt, now)}</span>
        <span className={`desk-ring ${remaining.seconds <= 5 ? "is-low" : ""}`} aria-live="polite">rings out in {remaining.seconds > 0 ? remaining.seconds : 0}s</span>
        <div className="desk-offer-actions">
          <button className="desk-accept" onClick={onAccept} disabled={busy} aria-keyshortcuts="A">Accept <kbd>A</kbd></button>
          {!declining && <button className="desk-ghost" onClick={() => setDeclining(true)} disabled={busy}>Decline</button>}
        </div>
      </header>
      {declining && (
        <form className="desk-decline" onSubmit={(event) => { event.preventDefault(); onDecline(reason); }}>
          <label>Reason<select value={reason} onChange={(event) => setReason(event.target.value)}><option>Not ready</option><option>Headset or audio issue</option><option>Not trained for this request</option><option>Language</option></select></label>
          <button className="desk-ghost" disabled={busy}>Decline and return to queue</button>
          <button type="button" className="desk-link" onClick={() => setDeclining(false)}>Cancel</button>
        </form>
      )}
      <h2 id={`offer-${offer.offerId}`} className="desk-sr-only">Offer for {offer.client.name}</h2>
      <ClientBanner context={offer} />
      <div className="desk-say-this" id={`offer-greeting-${offer.offerId}`}>
        <span>Say this</span>
        <p>“{offer.greeting.text}”</p>
        <small>{languageLabel(offer.escalation.language)}{offer.greeting.version ? ` · script v${offer.greeting.version}` : " · default greeting"}</small>
      </div>
      <div className="desk-offer-grid">
        <div>
          <h3>Caller</h3>
          <p><strong>{offer.caller.name || "Unknown caller"}</strong> {offer.caller.numberE164 && <span>{formatNumber(offer.caller.numberE164)}</span>}</p>
          <p className="desk-tags">{offer.caller.returning && <span>Returning caller · contact #{offer.caller.priorInteractions + 1}</span>}{offer.caller.vip && <span className="is-vip">VIP</span>}<span>{languageLabel(offer.caller.language)}</span></p>
          <h3>AI summary</h3>
          <p>{offer.ai.summary || "No summary yet."}</p>
        </div>
        <div>
          <h3>Why you have this</h3>
          <p>{humanize(offer.escalation.trigger)}{offer.escalation.triggerDetail ? ` — ${offer.escalation.triggerDetail}` : ""}</p>
          <h3>AI captured</h3>
          <CapturedList fields={offer.ai.captured} />
          <button className="desk-link" onClick={() => setShowTranscript(!showTranscript)} aria-expanded={showTranscript}>{showTranscript ? "Hide" : "Show"} transcript ({offer.transcript.length})</button>
          {showTranscript && <ol className="desk-transcript is-mini">{offer.transcript.map((turn) => <li key={turn.id} className={`from-${turn.speaker}`}><span>{turn.speaker}</span>{turn.text}</li>)}</ol>}
        </div>
      </div>
      <footer>
        <AuthoritySummary context={offer} />
        {offer.instructions.ownerNotes && <p className="desk-owner-note"><b>Owner note:</b> {offer.instructions.ownerNotes}</p>}
      </footer>
    </section>
  );
}
