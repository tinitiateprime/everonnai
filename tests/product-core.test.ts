import test from "node:test";
import assert from "node:assert/strict";
import { createDemoWorkspace } from "@/features/everonn/demo-data";
import { createWebsiteProject, generateDeterministicWebsiteSpec, runWebsiteQa } from "@/features/website-studio/generator";
import { buildReceptionistPrompt, detectUrgency, extractCallerDetails } from "@/features/voice-agent/engine";
import { bookGoogleCalendarAppointment, buildGmailRaw } from "@/features/integrations/google";
import { localDateTimeToUtc, parseEmbeddedJsonObject } from "@/features/voice-agent/appointment-time";

test("website generation preserves approved services and passes QA", () => {
  const profile = createDemoWorkspace().profile;
  const project = createWebsiteProject(profile, generateDeterministicWebsiteSpec(profile));
  assert.equal(project.concepts.length, 3);
  assert.equal(project.status, "generated");
  assert.equal(project.qa.passed, true);
  assert.deepEqual(project.spec.services.map((service) => service.name), profile.services.filter((service) => service.active).map((service) => service.name));
  assert.ok(project.spec.services.every((service) => service.slug && service.imageQuery && service.pageSections.length >= 2));
  assert.equal(project.spec.process.length, 3);
  assert.equal(project.spec.benefits.length, 3);
  assert.equal(runWebsiteQa(project.spec, profile).passed, true);
});

test("unsupported claims fail website QA", () => {
  const profile = createDemoWorkspace().profile;
  const project = createWebsiteProject(profile, generateDeterministicWebsiteSpec(profile));
  project.spec.about.body += " We are award-winning and guaranteed.";
  const qa = runWebsiteQa(project.spec, profile);
  assert.equal(qa.passed, false);
  assert.equal(qa.checks.find((check) => check.key === "no-unsupported-claims")?.passed, false);
});

test("phone front desk detects urgency and instructs AI not to invent pricing", () => {
  const profile = createDemoWorkspace().profile;
  assert.equal(detectUrgency("There is smoke and a gas leak"), "high");
  const prompt = buildReceptionistPrompt(profile);
  assert.match(prompt, /Never invent or estimate prices/);
  assert.match(prompt, /Never invent prices, availability, credentials, bookings, promises, or policies/);
});

test("front desk extracts written and spoken email addresses", () => {
  const at = new Date().toISOString();
  const written = extractCallerDetails([{ id: "1", role: "caller", text: "My name is Sam and my email is Sam.Test+quote@example.co.uk", at }]);
  assert.equal(written.callerName, "Sam");
  assert.equal(written.callerEmail, "sam.test+quote@example.co.uk");

  const spoken = extractCallerDetails([{ id: "2", role: "caller", text: "You can email me at alex dot smith at gmail dot com", at }]);
  assert.equal(spoken.callerEmail, "alex.smith@gmail.com");

  const labeled = extractCallerDetails([{ id: "3", role: "caller", text: "Contact details are name: Tester, phone number: +91 3729464785", at }]);
  assert.equal(labeled.callerName, "Tester");
});

test("appointment times use the business time zone", () => {
  assert.equal(localDateTimeToUtc("2026-10-02T11:00:00", "Asia/Kolkata").toISOString(), "2026-10-02T05:30:00.000Z");
  assert.equal(localDateTimeToUtc("2026-07-02T11:00:00", "America/Denver").toISOString(), "2026-07-02T17:00:00.000Z");
});

test("appointment extraction accepts a JSON object wrapped in model prose", () => {
  assert.deepEqual(
    parseEmbeddedJsonObject('Here is the result: {"appointmentRequested":true,"service":"Door installation","startsAtLocal":"2026-10-02T11:00:00"}'),
    { appointmentRequested: true, service: "Door installation", startsAtLocal: "2026-10-02T11:00:00" },
  );
});

test("Google Calendar bookings are idempotent and invite the customer", async () => {
  const previousFetch = globalThis.fetch;
  let requestedUrl = "";
  let requestedBody: Record<string, unknown> = {};
  globalThis.fetch = (async (input, init) => {
    requestedUrl = String(input);
    requestedBody = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    return new Response(JSON.stringify({ id: "event_1", htmlLink: "https://calendar.google.com/event" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const event = await bookGoogleCalendarAppointment({
      accessToken: "token",
      calendarId: "primary",
      eventId: "abcdef123456",
      startsAt: "2026-10-02T05:30:00.000Z",
      endsAt: "2026-10-02T06:30:00.000Z",
      timeZone: "Asia/Kolkata",
      businessName: "US Carpentry Services",
      service: "Door installation",
      customerName: "Tester",
      customerPhone: "+91 3729464785",
      customerEmail: "tester@example.com",
      reason: "Book door installation",
      sourceLeadId: "lead_1",
    });
    assert.equal(event.id, "event_1");
    assert.match(requestedUrl, /calendars\/primary\/events\?sendUpdates=all$/);
    assert.equal(requestedBody.id, "abcdef123456");
    assert.deepEqual(requestedBody.attendees, [{ email: "tester@example.com" }]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Gmail messages are encoded without exposing credentials", () => {
  const raw = buildGmailRaw({ from: "team@example.com", to: "owner@example.com", subject: "EverOnn call summary", text: "A customer called." });
  const decoded = Buffer.from(raw, "base64url").toString("utf8");
  assert.match(decoded, /Subject: EverOnn call summary/);
  assert.match(decoded, /A customer called/);
});
