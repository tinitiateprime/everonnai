"use client";

import { useRef, useState, type FormEvent, type MouseEvent } from "react";
import type { BusinessProfile, Lead } from "@/features/everonn/types";
import { WebsiteAssistant } from "./website-assistant";

function CustomerRequestForm({ profile, previewToken, publicSlug }: { profile: BusinessProfile; previewToken?: string; publicSlug?: string }) {
  const requestId = useRef("");
  const [appointment, setAppointment] = useState(true);
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || complete) return;
    const values = new FormData(event.currentTarget);
    if (!String(values.get("phone") || "").trim() && !String(values.get("email") || "").trim()) { setError("Add a callback number or email so the team can reach you."); return; }
    setBusy(true); setError("");
    if (!requestId.current) requestId.current = crypto.randomUUID();
    try {
      const response = await fetch("/api/site-assistant/lead", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ previewToken, publicSlug, requestId: requestId.current, source: "website", callerName: values.get("name"), callerPhone: values.get("phone"), callerEmail: values.get("email"), reason: values.get("message"), finalize: true,
          ...(appointment ? { appointmentRequest: { serviceId: values.get("service"), date: values.get("date"), time: values.get("time") } } : {}),
        }),
      });
      const data = await response.json() as { lead?: Lead; error?: string; message?: string };
      if (!response.ok || !data.lead) throw new Error(data.error || "Your request could not be saved. Please call the business.");
      const confirmed = data.lead.automation?.appointmentStatus === "confirmed";
      setMessage(confirmed ? "Your appointment is confirmed. The team has your request." : data.lead.automation?.message || "Your request is saved. The team will confirm availability and the next step.");
      setComplete(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Your request could not be saved."); }
    finally { setBusy(false); }
  }
  if (complete) return <p className="website-request-success" role="status">{message}</p>;
  return <form className="website-request-form" onSubmit={submit}>
    <label>Your name<input name="name" autoComplete="name" required maxLength={120} /></label>
    <label>Callback number<input name="phone" type="tel" autoComplete="tel" maxLength={40} /></label>
    <label>Email<input name="email" type="email" autoComplete="email" maxLength={254} /></label>
    <label>How can we help?<textarea name="message" required maxLength={4000} rows={3} /></label>
    <label className="website-request-checkbox"><input type="checkbox" checked={appointment} onChange={(event) => setAppointment(event.target.checked)} />Request an appointment</label>
    {appointment && <>
      <label>Requested service<select name="service" required><option value="">Choose a service</option>{profile.services.filter((item) => item.active).map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
      <div className="website-request-time"><label>Preferred date<input name="date" type="date" required /></label><label>Preferred time<input name="time" type="time" required /></label></div>
      <small>Times are in {profile.timeZone}. Your appointment is confirmed only after the calendar accepts it.</small>
    </>}
    {error && <p role="alert">{error}</p>}
    <button type="submit" disabled={busy}>{busy ? "Submitting request…" : "Send request"}</button>
  </form>;
}

export function WebsitePage({ html, css, profile, previewToken, publicSlug }: { html: string; css: string; profile: BusinessProfile; previewToken?: string; publicSlug?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  function action(event: MouseEvent<HTMLDivElement>) {
    const target = (event.target as Element).closest<HTMLElement>("[data-everonn-action]");
    if (!target || !event.currentTarget.contains(target)) return;
    event.preventDefault();
    const mode = target.dataset.everonnAction;
    if (mode === "booking") dialog.current?.showModal();
    else if (mode === "chat" || mode === "voice") document.querySelector<HTMLButtonElement>(`.client-assistant-actions button.${mode}`)?.click();
  }
  return <>
    <div id="everonn-generated-site" onClick={action}><style>{css}</style><div dangerouslySetInnerHTML={{ __html: html }} /></div>
    <dialog id="everonn-request" ref={dialog} className="website-request-dialog" aria-labelledby="website-request-title">
      <header><div><small>{profile.businessName}</small><h2 id="website-request-title">Tell us what you need.</h2></div><button type="button" onClick={() => dialog.current?.close()} aria-label="Close request form">×</button></header>
      <CustomerRequestForm profile={profile} previewToken={previewToken} publicSlug={publicSlug} />
    </dialog>
    <WebsiteAssistant profile={profile} previewToken={previewToken} publicSlug={publicSlug} />
  </>;
}
