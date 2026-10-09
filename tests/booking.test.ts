import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  bookingStatus,
  runBookingTool,
  type bookingDeps,
} from "../lib/booking";
import {
  decryptPayload,
  encryptPayload,
  withIntegration,
} from "../lib/integrations-store";
import { signOAuthState, verifyOAuthState } from "../lib/google-oauth";
import { sessionVariables } from "../lib/assistant";
import { brief } from "./fixtures";

const KEY = "test-credential-encryption-key-0123456789";
const scopes = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
  "https://www.googleapis.com/auth/gmail.send",
];
async function withEnv(task: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "everonn-booking-"));
  const previous = {
    dir: process.env.INTEGRATIONS_DIR,
    key: process.env.CREDENTIAL_ENCRYPTION_KEY,
  };
  process.env.INTEGRATIONS_DIR = dir;
  process.env.CREDENTIAL_ENCRYPTION_KEY = KEY;
  try {
    await task(dir);
  } finally {
    for (const [name, value] of [
      ["INTEGRATIONS_DIR", previous.dir],
      ["CREDENTIAL_ENCRYPTION_KEY", previous.key],
    ] as const)
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    await rm(dir, { recursive: true, force: true });
  }
}
function fakeGoogle(options: { busy?: boolean; connected?: boolean } = {}) {
  const calls = {
    booked: [] as Record<string, unknown>[],
    emails: [] as Record<string, unknown>[],
  };
  const events = new Map<string, { id: string; htmlLink: string }>();
  const deps: typeof bookingDeps = {
    connection: async () =>
      options.connected === false
        ? null
        : {
            accessToken: "token",
            refreshToken: "refresh",
            expiresAt: Date.now() + 3_600_000,
            scope: scopes,
            tokenType: "Bearer",
            connectedAt: "2026-10-09T00:00:00.000Z",
          },
    accessToken: async () => "token",
    availability: async () => ({ available: !options.busy, busy: [] }),
    findEvent: async (input) => events.get(input.eventId) as never,
    book: async (input) => {
      calls.booked.push(input);
      const event = {
        id: input.eventId,
        htmlLink: "https://calendar.google.com/e",
      };
      events.set(input.eventId, event);
      return event;
    },
    sendEmail: async (input) => {
      calls.emails.push(input);
      return { id: "mail-1", threadId: "t" };
    },
    now: () => new Date("2026-10-09T08:00:00.000Z"),
  };
  return { deps, calls };
}
const settings = {
  timeZone: "Asia/Kolkata",
  durationMinutes: 30,
  notifyEmail: "owner@northline.example",
};

test("credentials round-trip encrypted and OAuth state is signed and expiring", async () => {
  await withEnv(async () => {
    const sealed = encryptPayload({ refreshToken: "secret-refresh" });
    assert.ok(!JSON.stringify(sealed).includes("secret-refresh"));
    assert.deepEqual(decryptPayload(sealed), {
      refreshToken: "secret-refresh",
    });
    const state = signOAuthState("northline");
    assert.equal(verifyOAuthState(state), "northline");
    assert.throws(() => verifyOAuthState(`${state.slice(0, -2)}xx`), /Invalid/);
    assert.throws(
      () =>
        verifyOAuthState(signOAuthState("northline", Date.now() - 11 * 60_000)),
      /expired/,
    );
  });
});

test("booking stays off until Google and a time zone are configured", async () => {
  await withEnv(async () => {
    const { deps } = fakeGoogle({ connected: false });
    const result = await runBookingTool(
      "northline",
      brief,
      "check_availability",
      {
        date: "2026-10-12",
        time: "10:00",
        service: "AC installation",
      },
      deps,
    );
    assert.equal(result.booked, false);
    assert.equal(result.available, null);
    assert.match(result.message, /not connected/);
    const connectedNoZone = fakeGoogle();
    assert.equal(
      (await bookingStatus("northline", connectedNoZone.deps)).calendarReady,
      false,
    );
  });
});

test("voice booking validates, checks the calendar, books once and emails the owner", async () => {
  await withEnv(async () => {
    await withIntegration("northline", (record, save) =>
      save({ ...record, settings }),
    );
    const { deps, calls } = fakeGoogle();
    const slot = {
      date: "2026-10-12",
      time: "10:00",
      service: "ac installation",
    };

    const unknown = await runBookingTool(
      "northline",
      brief,
      "check_availability",
      { ...slot, service: "Roof repair" },
      deps,
    );
    assert.match(unknown.message, /Offered services: AC installation/);
    const past = await runBookingTool(
      "northline",
      brief,
      "check_availability",
      { ...slot, date: "2026-10-01" },
      deps,
    );
    assert.match(past.message, /future date/);
    const vague = await runBookingTool(
      "northline",
      brief,
      "check_availability",
      { ...slot, time: "morning" },
      deps,
    );
    assert.match(vague.message, /exact date and time/);

    const free = await runBookingTool(
      "northline",
      brief,
      "check_availability",
      slot,
      deps,
    );
    assert.equal(free.available, true);
    assert.equal(free.booked, false);

    const unconfirmed = await runBookingTool(
      "northline",
      brief,
      "book_appointment",
      {
        ...slot,
        caller_name: "Asha Rao",
        caller_phone: "+91 98450 12345",
        caller_confirmed: false,
      },
      deps,
    );
    assert.equal(unconfirmed.booked, false);
    assert.equal(calls.booked.length, 0);

    const booking = {
      ...slot,
      caller_name: "Asha Rao",
      caller_phone: "+91 98450 12345",
      caller_confirmed: true,
    };
    const booked = await runBookingTool(
      "northline",
      brief,
      "book_appointment",
      booking,
      deps,
    );
    assert.equal(booked.booked, true, booked.message);
    assert.equal(calls.booked.length, 1);
    // 10:00 in Asia/Kolkata (UTC+5:30) is 04:30 UTC; 30-minute appointment.
    assert.equal(calls.booked[0].startsAt, "2026-10-12T04:30:00.000Z");
    assert.equal(calls.booked[0].endsAt, "2026-10-12T05:00:00.000Z");
    assert.equal(calls.booked[0].service, "AC installation");
    assert.equal(calls.emails.length, 1);
    assert.equal(calls.emails[0].to, "owner@northline.example");
    assert.match(String(calls.emails[0].text), /Asha Rao/);

    // A retried tool call finds the same event instead of booking twice.
    const again = await runBookingTool(
      "northline",
      brief,
      "book_appointment",
      booking,
      deps,
    );
    assert.equal(again.booked, true);
    assert.equal(calls.booked.length, 1);
    assert.equal(calls.emails.length, 1);
    const status = await bookingStatus("northline", deps);
    assert.equal(status.calendarReady, true);
    assert.equal(
      status.activity.filter((a) => a.kind === "appointment").length,
      1,
    );
  });
});

test("busy slots are never booked and callbacks are saved and emailed", async () => {
  await withEnv(async () => {
    await withIntegration("northline", (record, save) =>
      save({ ...record, settings }),
    );
    const busy = fakeGoogle({ busy: true });
    const result = await runBookingTool(
      "northline",
      brief,
      "book_appointment",
      {
        date: "2026-10-12",
        time: "11:00",
        service: "AC installation",
        caller_name: "Asha Rao",
        caller_phone: "9845012345",
        caller_confirmed: true,
      },
      busy.deps,
    );
    assert.equal(result.booked, false);
    assert.equal(result.available, false);
    assert.equal(busy.calls.booked.length, 0);

    const noPhone = await runBookingTool(
      "northline",
      brief,
      "capture_lead",
      { caller_name: "Ben" },
      busy.deps,
    );
    assert.equal(noPhone.saved, false);
    const lead = await runBookingTool(
      "northline",
      brief,
      "request_human_handoff",
      {
        caller_name: "Ben",
        caller_phone: "+1 212 555 0199",
        reason: "Wants to discuss a large order",
        urgency: "high",
      },
      busy.deps,
    );
    assert.equal(lead.saved, true);
    assert.match(
      String(busy.calls.emails[0].subject),
      /^Urgent: Callback request from Ben/,
    );
    const activity = (await bookingStatus("northline", busy.deps)).activity;
    assert.equal(activity[0].kind, "handoff");
    assert.equal(activity[0].email, "sent");
  });
});

test("the live agent is told about booking only when the calendar is ready", () => {
  const context = {
    name: "Northline",
    greeting: "Hi",
    knowledge: brief,
    knowledgeJson: JSON.stringify({
      ownerKnowledge: brief,
      sourceWebsite: null,
    }),
  } as Parameters<typeof sessionVariables>[0];
  const off = sessionVariables(context);
  assert.equal(off.calendar_connected, "false");
  assert.match(off.approved_instructions, /Online booking is not connected/);
  const on = sessionVariables(context, {
    calendarReady: true,
    timeZone: "Asia/Kolkata",
    durationMinutes: 30,
  });
  assert.equal(on.calendar_connected, "true");
  assert.equal(on.time_zone, "Asia/Kolkata");
  assert.equal(on.appointment_duration_minutes, "30");
  assert.match(on.approved_instructions, /check_availability/);
  assert.ok(!on.approved_instructions.includes("This website has no calendar"));
  assert.ok(!on.faq_notes.includes("This website has no calendar"));
});

test("booking route sends the real Google Calendar and Gmail requests for a saved site", async () => {
  await withEnv(async (dir) => {
    const { saveGeneratedSite } = await import("../lib/site-store");
    const { POST } = await import("../app/api/site-assistant/booking/route");
    const { website, model } = await import("./fixtures");
    const previous = {
      sites: process.env.GENERATED_SITES_DIR,
      id: process.env.GOOGLE_OAUTH_CLIENT_ID,
      secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      fetch: globalThis.fetch,
    };
    process.env.GENERATED_SITES_DIR = path.join(dir, "sites");
    process.env.GOOGLE_OAUTH_CLIENT_ID = "client";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret";
    const requests: { url: string; method: string; body: unknown }[] = [];
    globalThis.fetch = async (url, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ url: String(url), method: init?.method ?? "GET", body });
      const target = String(url);
      if (target.endsWith("/freeBusy"))
        return Response.json({ calendars: { primary: { busy: [] } } });
      if (target.includes("/events/") && (init?.method ?? "GET") === "GET")
        return Response.json(
          { error: { message: "Not found" } },
          { status: 404 },
        );
      if (target.includes("/events"))
        return Response.json({
          id: body.id,
          htmlLink: "https://calendar.google.com/x",
        });
      if (target.includes("/messages/send"))
        return Response.json({ id: "m1", threadId: "t1" });
      return Response.json({}, { status: 500 });
    };
    try {
      const saved = await saveGeneratedSite(brief, {
        id: "rev-1",
        index: 0,
        name: "Design",
        rationale: "r",
        html: website(),
        model: model.id,
        createdAt: new Date().toISOString(),
        warnings: [],
      });
      await withIntegration("northline", (record, save) =>
        save({
          ...record,
          settings,
          google: encryptPayload({
            accessToken: "live-token",
            refreshToken: "refresh",
            expiresAt: Date.now() + 3_600_000,
            scope: scopes,
            tokenType: "Bearer",
            connectedAt: new Date().toISOString(),
          }),
        }),
      );
      const response = await POST(
        new Request("http://localhost:3000/api/site-assistant/booking", {
          method: "POST",
          headers: {
            origin: "http://localhost:3000",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            business: "northline",
            version: "1",
            revision: saved.id,
            tool: "book_appointment",
            args: {
              date: "2027-03-04",
              time: "15:30",
              service: "AC installation",
              caller_name: "Asha Rao",
              caller_phone: "+91 98450 12345",
              caller_confirmed: true,
            },
          }),
        }),
      );
      const data = await response.json();
      assert.equal(data.booked, true, data.message);
      const created = requests.find(
        (r) =>
          r.method === "POST" && /\/calendars\/primary\/events$/.test(r.url),
      );
      assert.ok(created, JSON.stringify(requests.map((r) => r.url)));
      const event = created!.body as Record<
        string,
        { dateTime: string; timeZone: string }
      >;
      assert.deepEqual(event.start, {
        dateTime: "2027-03-04T10:00:00.000Z",
        timeZone: "Asia/Kolkata",
      });
      assert.match(String(event.summary), /AC installation · Asha Rao/);
      const mail = requests.find((r) =>
        r.url.endsWith("/users/me/messages/send"),
      );
      const raw = Buffer.from(
        String((mail!.body as { raw: string }).raw),
        "base64url",
      ).toString("utf8");
      assert.match(raw, /^To: owner@northline\.example/m);
      assert.ok(!/^From:/m.test(raw));
    } finally {
      globalThis.fetch = previous.fetch;
      for (const [name, value] of [
        ["GENERATED_SITES_DIR", previous.sites],
        ["GOOGLE_OAUTH_CLIENT_ID", previous.id],
        ["GOOGLE_OAUTH_CLIENT_SECRET", previous.secret],
      ] as const)
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
    }
  });
});
