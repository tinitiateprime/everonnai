import assert from "node:assert/strict";
import test from "node:test";
import { createDemoWorkspace } from "@/features/everonn/demo-data";
import { captureWorkspaceLead, preserveContactServerState, preserveLeadServerState, type LeadCaptureInput } from "@/features/everonn/lead-capture";
import { runLeadAutomation } from "@/features/integrations/lead-automation-core";
import { checkGoogleCalendarAvailability, findGoogleCalendarAppointment } from "@/features/integrations/google";
import { bookingClarification, validateExtractedIntent, validateAppointmentRequest } from "@/features/voice-agent/appointment-validation";
import { createLeadCaptureQueue } from "@/features/voice-agent/capture-client";
import { detectUrgency, extractCallerDetails } from "@/features/voice-agent/engine";
import { localDateTimeToUtc } from "@/features/voice-agent/appointment-time";
import { customerWorkspaceView } from "@/features/everonn/sample-records";
import { bookingToolResult, buildVoiceSessionVariables } from "@/features/voice-agent/session-context";

const input: LeadCaptureInput = { requestId: "request_1234567890", callerName: "Sam", callerPhone: "+91 9876543210", callerEmail: "sam@example.com", reason: "Book Seasonal maintenance for my heat pump", urgency: "normal", source: "chat" };

test("legacy demo records are kept out of real customer screens without removing stored data", () => {
  const workspace = createDemoWorkspace();
  const original = JSON.stringify(workspace);
  const view = customerWorkspaceView(workspace);
  assert.equal(view.appointments.length, 0);
  assert.equal(view.leads.length, 0);
  assert.equal(view.contacts.length, 0);
  assert.equal(view.conversations.length, 0);
  assert.equal(JSON.stringify(workspace), original);
  workspace.leads[0].reason = "An actual updated customer request";
  assert.equal(customerWorkspaceView(workspace).leads.length, 1);
});

function fixture() {
  let workspace = createDemoWorkspace();
  workspace.leads = [];
  workspace.contacts = [];
  workspace.appointments = [];
  workspace.profile.timeZone = "Asia/Kolkata";
  const date = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);
  workspace = captureWorkspaceLead(workspace, { ...input, appointmentRequest: { serviceId: "svc_maintenance", date, time: "14:30" } }).workspace;
  let sends = 0;
  let bookings = 0;
  let checks = 0;
  const deps: Parameters<typeof runLeadAutomation>[2] = {
    read: async () => structuredClone(workspace),
    update: async (mutate) => { workspace = mutate(structuredClone(workspace)); return structuredClone(workspace); },
    getConnection: async () => ({ scope: ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/gmail.send"] }),
    getAccessToken: async () => "test-token",
    extractIntent: async () => ({ requested: true, service: "Seasonal maintenance", startsAtLocal: "" }),
    availability: async () => { checks += 1; return { available: true, busy: [] }; },
    findEvent: async () => null,
    book: async (request) => { bookings += 1; assert.equal(request.service, "Seasonal maintenance"); assert.equal(request.reason, input.reason); return { id: "event_1", htmlLink: "https://calendar.google.com/test" }; },
    sendEmail: async (request) => { sends += 1; assert.match(request.text, /heat pump/); assert.match(request.text, /14:30 \(Asia\/Kolkata\)/); return { id: "mail_1", threadId: "thread_1" }; },
    followUpEnabled: true,
  };
  return { deps, leadId: workspace.leads[0].id, workspaceId: workspace.workspaceId, date, get workspace() { return workspace; }, set workspace(value) { workspace = value; }, get sends() { return sends; }, get bookings() { return bookings; }, get checks() { return checks; } };
}

test("completed service requests book the selected time and send only one notification across updates and retries", async () => {
  const f = fixture();
  const first = await runLeadAutomation(f.leadId, f.workspaceId, f.deps);
  assert.equal(first.appointment?.time, "14:30");
  assert.equal(first.appointment?.startsAt, `${f.date}T09:00:00.000Z`);
  assert.equal(first.appointment?.requestDetails, input.reason);
  f.workspace = captureWorkspaceLead(f.workspace, { ...input, reason: `${input.reason}. The filter needs replacing.` }).workspace;
  const second = await runLeadAutomation(f.leadId, f.workspaceId, f.deps);
  assert.equal(f.sends, 1);
  assert.equal(f.bookings, 1);
  assert.equal(second.lead.automation?.gmailMessageId, "mail_1");
  assert.match(second.lead.automation?.message || "", /changed after booking/);
});

test("collecting transcripts do not send email or allocate a calendar time", async () => {
  const f = fixture();
  f.workspace.leads[0].captureStatus = "collecting";
  await runLeadAutomation(f.leadId, f.workspaceId, f.deps);
  assert.equal(f.sends, 0);
  assert.equal(f.bookings, 0);
  assert.equal(f.workspace.automationLock, undefined);
});

test("missing service/date/time remains a request needing details", async () => {
  const f = fixture();
  delete f.workspace.leads[0].appointmentRequest;
  f.deps.followUpEnabled = false;
  const result = await runLeadAutomation(f.leadId, f.workspaceId, f.deps);
  assert.equal(result.lead.automation?.appointmentStatus, "needs_details");
  assert.equal(result.appointment, null);
  assert.equal(f.checks, 0);
  assert.equal(f.bookings, 0);
});

test("a busy calendar preserves the actual preferred time without choosing an alternative", async () => {
  const f = fixture();
  f.deps.availability = async () => ({ available: false, busy: [{ start: "busy", end: "busy" }] });
  const result = await runLeadAutomation(f.leadId, f.workspaceId, f.deps);
  assert.equal(result.appointment?.time, "14:30");
  assert.equal(result.appointment?.status, "requested");
  assert.equal(result.lead.automation?.appointmentStatus, "unavailable");
  assert.equal(f.bookings, 0);
});

test("disconnected calendar retains the selected service and time as an unconfirmed request", async () => {
  const f = fixture();
  f.deps.getConnection = async () => null;
  const result = await runLeadAutomation(f.leadId, f.workspaceId, f.deps);
  assert.equal(result.appointment?.status, "requested");
  assert.equal(result.appointment?.time, "14:30");
  assert.equal(f.bookings, 0);
  assert.equal(f.sends, 0);
});

test("a cancelled appointment cannot be booked again by a retry with the same request", async () => {
  const f = fixture();
  f.workspace.appointments = [{
    id: "cancelled_appointment", workspaceId: f.workspaceId, leadId: f.leadId,
    contactName: "Sam", contactPhone: input.callerPhone, contactEmail: input.callerEmail,
    service: "Seasonal maintenance", date: f.date, time: "14:30", status: "cancelled",
    provider: "manual", createdAt: new Date().toISOString(),
  }];
  const result = await runLeadAutomation(f.leadId, f.workspaceId, f.deps);
  assert.equal(result.appointment?.status, "cancelled");
  assert.equal(result.lead.automation?.appointmentStatus, "cancelled");
  assert.match(result.lead.automation?.message || "", /Choose a new service, date, or time/);
  assert.equal(f.checks, 0);
  assert.equal(f.bookings, 0);
});

test("uncertain Gmail delivery is never automatically resent, including after further customer updates", async () => {
  const f = fixture();
  let attempts = 0;
  f.deps.sendEmail = async () => { attempts += 1; throw new Error("Connection closed after accepting the message"); };
  const first = await runLeadAutomation(f.leadId, f.workspaceId, f.deps);
  assert.equal(first.lead.automation?.gmailStatus, "delivery_unknown");
  assert.ok(first.lead.automation?.gmailAttemptedAt);
  f.workspace = captureWorkspaceLead(f.workspace, { ...input, reason: `${input.reason}. Call before arrival.` }).workspace;
  await runLeadAutomation(f.leadId, f.workspaceId, f.deps);
  assert.equal(attempts, 1);
});

test("an old pending Gmail reservation cannot expire into a duplicate send", async () => {
  const f = fixture();
  f.workspace.leads[0].automation = { appointmentStatus: "not_requested", gmailStatus: "pending", processedAt: "2020-01-01T00:00:00Z" };
  await runLeadAutomation(f.leadId, f.workspaceId, f.deps);
  assert.equal(f.sends, 0);
});

test("a durable workspace lease prevents overlapping automation in another worker", async () => {
  const f = fixture();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  f.deps.availability = async () => { await gate; return { available: true, busy: [] }; };
  const first = runLeadAutomation(f.leadId, f.workspaceId, f.deps);
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(runLeadAutomation(f.leadId, f.workspaceId, f.deps), /Another request is processing/);
  release();
  await first;
  assert.equal(f.sends, 1);
  assert.equal(f.bookings, 1);
});

test("calendar retry recovers an accepted event before checking its now-busy slot", async () => {
  const f = fixture();
  f.deps.findEvent = async () => ({ id: "already_booked", start: {}, end: {} });
  const result = await runLeadAutomation(f.leadId, f.workspaceId, f.deps);
  assert.equal(result.appointment?.googleEventId, "already_booked");
  assert.equal(result.appointment?.status, "confirmed");
  assert.equal(f.checks, 0);
  assert.equal(f.bookings, 0);
});

test("stale workspace saves retain server email, booking, and request details", () => {
  const f = fixture();
  const stale = structuredClone(f.workspace.leads);
  f.workspace.leads[0].automation = { appointmentStatus: "confirmed", googleEventId: "event", gmailStatus: "sent", gmailMessageId: "mail", processedAt: new Date().toISOString() };
  f.workspace.leads[0].reason = "The complete request with later service and time details";
  stale[0].status = "follow_up";
  const saved = preserveLeadServerState(f.workspace.leads, stale)[0];
  assert.equal(saved.automation?.gmailStatus, "sent");
  assert.equal(saved.reason, f.workspace.leads[0].reason);
  assert.equal(saved.status, "follow_up");
});

test("one conversation remains one lead when phone/email changes; a new request has its own lead", () => {
  const f = fixture();
  const updated = captureWorkspaceLead(f.workspace, { ...input, callerEmail: "new@example.com", callerPhone: "+91 9999999999", reason: "The latest complete request" });
  assert.equal(updated.lead.id, f.leadId);
  assert.equal(updated.workspace.leads.length, 1);
  const next = captureWorkspaceLead(updated.workspace, { ...input, requestId: "different_1234567890" });
  assert.equal(next.workspace.leads.length, 2);
});

test("invented timestamps and unrelated services from the model cannot authorize a booking", () => {
  const profile = createDemoWorkspace().profile;
  profile.timeZone = "Asia/Kolkata";
  const now = new Date("2026-10-01T08:00:00Z");
  const value = { appointmentRequested: true, service: "Seasonal maintenance", startsAtLocal: "2026-10-02T10:00:00", serviceEvidence: "Seasonal maintenance", dateEvidence: "tomorrow", timeEvidence: "10 AM" };
  assert.equal(validateExtractedIntent(value, profile, "Book Seasonal maintenance tomorrow", now).startsAtLocal, "");
  assert.equal(validateExtractedIntent(value, profile, "Book Seasonal maintenance tomorrow at 10 AM", now).startsAtLocal, value.startsAtLocal);
  assert.equal(validateExtractedIntent({ ...value, startsAtLocal: "2026-10-02T11:00:00" }, profile, "Book Seasonal maintenance tomorrow at 10 AM", now).startsAtLocal, "");
  assert.equal(validateExtractedIntent({ ...value, service: "Dental cleaning" }, profile, "Book Seasonal maintenance tomorrow at 10 AM", now).service, "");
  assert.equal(validateExtractedIntent({ ...value, timeEvidence: "morning" }, profile, "Book Seasonal maintenance tomorrow morning", now).startsAtLocal, "");
  assert.match(bookingClarification(profile, "Book Seasonal maintenance tomorrow", now), /What exact time/);
});

test("date and time must be chosen explicitly and cannot be invalid or a daylight-saving ambiguity", () => {
  const f = fixture();
  assert.throws(() => validateAppointmentRequest({ serviceId: "svc_maintenance", date: f.date, time: "" }, f.workspace.profile), /both/);
  assert.throws(() => localDateTimeToUtc("2026-02-30T10:00:00", "Asia/Kolkata"), /does not exist/);
  assert.throws(() => localDateTimeToUtc("2026-03-08T02:30:00", "America/New_York"), /does not exist/);
  assert.throws(() => localDateTimeToUtc("2026-11-01T01:30:00", "America/New_York"), /ambiguous/);
});

test("appointment dates are not mistaken for callback numbers or customer names", () => {
  const details = extractCallerDetails([{ id: "1", role: "caller", text: "I am looking for Seasonal maintenance on 2026-10-02 at 11:00 AM", at: new Date().toISOString() }]);
  assert.equal(details.callerPhone, "");
  assert.equal(details.callerName, "");
});

test("failed or missing Google freeBusy data cannot be treated as available", async () => {
  const previous = globalThis.fetch;
  try {
    for (const payload of [{}, { calendars: { primary: { errors: [{ reason: "notFound" }] } } }]) {
      globalThis.fetch = async () => new Response(JSON.stringify(payload));
      await assert.rejects(checkGoogleCalendarAvailability({ accessToken: "token", calendarId: "primary", startsAt: "start", endsAt: "end", timeZone: "UTC" }), /could not verify availability/);
    }
    globalThis.fetch = async () => new Response(JSON.stringify({ calendars: { primary: { busy: [] } } }));
    assert.equal((await checkGoogleCalendarAvailability({ accessToken: "token", calendarId: "primary", startsAt: "start", endsAt: "end", timeZone: "UTC" })).available, true);
  } finally { globalThis.fetch = previous; }
});

test("recovery of a conflicting Google event verifies its actual time instead of displaying a false booking", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ id: "event", start: { dateTime: "2026-10-02T10:00:00Z" }, end: { dateTime: "2026-10-02T11:00:00Z" } }));
  try { await assert.rejects(findGoogleCalendarAppointment({ accessToken: "token", calendarId: "primary", eventId: "event", startsAt: "2026-10-02T12:00:00Z", endsAt: "2026-10-02T13:00:00Z" }), /different details/); }
  finally { globalThis.fetch = previous; }
});

test("browser captures serialize progressive details and final submission without losing later messages", async () => {
  const calls: LeadCaptureInput[] = [];
  const f = fixture();
  const queue = createLeadCaptureQueue({ requestId: input.requestId!, fetchImpl: async (_url, init) => {
    calls.push(JSON.parse(String(init?.body)) as LeadCaptureInput);
    return new Response(JSON.stringify({ saved: true, lead: f.workspace.leads[0], contact: f.workspace.contacts[0] }));
  } });
  const collecting = { ...input, finalize: false };
  const first = queue(collecting);
  const duplicate = queue(collecting);
  const final = queue({ ...input, reason: input.reason + " tomorrow at 2:30 PM", finalize: true });
  await Promise.all([first, duplicate, final]);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].finalize, true);
  assert.match(calls[1].reason, /2:30 PM/);
});

test("voice variables populate every placeholder used by the connected template with real business instructions", () => {
  const f = fixture();
  f.workspace.profile.hours = "";
  const variables = buildVoiceSessionVariables(f.workspace.profile, true);
  assert.match(variables.faq_notes, /exact time/);
  assert.match(variables.faq_notes, /Asia\/Kolkata/);
  assert.equal(variables.calendar_connected, "true");
  assert.equal(variables.appointment_duration_minutes, "60");
  assert.equal(variables.faq_notes, variables.approved_instructions);
  assert.match(variables.business_hours, /do not invent hours/);
});

test("voice booking tools return booked=true only after the server confirms the calendar event", async () => {
  const f = fixture();
  const confirmed = await runLeadAutomation(f.leadId, f.workspaceId, f.deps);
  const data = { saved: true, ...confirmed, contact: f.workspace.contacts[0] };
  assert.equal(JSON.parse(bookingToolResult(data)).booked, true);
  assert.equal(JSON.parse(bookingToolResult({ ...data, appointment: { ...data.appointment!, status: "requested" } })).booked, false);
  assert.equal(JSON.parse(bookingToolResult(null)).saved, false);
  assert.equal(JSON.parse(bookingToolResult(null)).booked, false);
});

test("customer corrections replace earlier contact details, and stale saves cannot undo them", () => {
  const details = extractCallerDetails([{ id: "1", role: "caller", text: "My name is Sam and my phone is +91 9876543210, email sam@example.com. Actually my name is Lee and my phone is +91 9999999999, email lee@example.com.", at: new Date().toISOString() }]);
  assert.equal(details.callerName, "Lee");
  assert.equal(details.callerPhone, "+91 9999999999");
  assert.equal(details.callerEmail, "lee@example.com");
  const f = fixture();
  const original = structuredClone(f.workspace.contacts);
  f.workspace.contacts[0] = { ...f.workspace.contacts[0], email: "corrected@example.com", lastContactAt: new Date(Date.now() + 1000).toISOString() };
  assert.equal(preserveContactServerState(f.workspace.contacts, original)[0].email, "corrected@example.com");
  assert.equal(detectUrgency("This is not urgent"), "low");
  assert.equal(detectUrgency("This is not urgent but I can see smoke"), "high");
});
