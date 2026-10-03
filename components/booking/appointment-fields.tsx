"use client";

import { useState, type FormEvent } from "react";
import type { BusinessProfile, Lead } from "@/features/everonn/types";

export function AppointmentFields({ profile, onSubmit }: { profile: BusinessProfile; onSubmit: (request: NonNullable<Lead["appointmentRequest"]>) => Promise<void> }) {
  const [serviceId, setServiceId] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try { await onSubmit({ serviceId, date, time }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The request could not be submitted."); }
    finally { setBusy(false); }
  }
  return <form className="appointment-request-form" onSubmit={submit}>
    <label>Requested service<select required value={serviceId} onChange={(event) => setServiceId(event.target.value)}><option value="">Choose a service</option>{profile.services.filter((item) => item.active).map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
    <label>Preferred date<input type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></label>
    <label>Preferred time<input type="time" required value={time} onChange={(event) => setTime(event.target.value)} /></label>
    <small>All times are in {profile.timeZone}. The calendar must accept the request before it is confirmed.</small>
    {error && <p role="alert">{error}</p>}
    <button type="submit" disabled={busy || !serviceId || !date || !time}>{busy ? "Submitting request…" : "Submit appointment request"}</button>
  </form>;
}
