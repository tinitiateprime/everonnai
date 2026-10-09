import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";
import { newId, toBinaryId, toExternalId, uuidv7 } from "../features/call-center/ids";
import {
  authorityFor, canTransitionEscalation, canTransitionHandling, cascadeDecision, maskPhone, maskSensitiveText, renderGreeting, selectOperator, validateWrapUp, withinWindows,
} from "../features/call-center/workflow";

// Pure rules always run. The MySQL workflow suite runs when
// CALL_CENTER_TEST_DATABASE_URL points at a disposable MySQL 8 database; it
// drops and recreates every desk table there.

test("prefixed UUIDv7 identifiers round-trip and reject other prefixes", () => {
  const { bytes, id } = newId("esc");
  assert.match(id, /^esc_[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.deepEqual(toBinaryId("esc", id), bytes);
  assert.throws(() => toBinaryId("tnt", id));
  assert.equal(uuidv7(1_700_000_000_000)[6] >> 4, 7);
  assert.ok(toExternalId("esc", uuidv7(1))! < toExternalId("esc", uuidv7(2))!, "time ordered");
});

test("state machines follow §16.6", () => {
  assert.ok(canTransitionEscalation("created", "notified"));
  assert.ok(canTransitionEscalation("notified", "acknowledged"));
  assert.ok(!canTransitionEscalation("resolved", "notified"));
  assert.ok(!canTransitionEscalation("closed", "reviewed"));
  assert.ok(canTransitionHandling("active", "on_hold"));
  assert.ok(canTransitionHandling("wrap_up", "completed"));
  assert.ok(!canTransitionHandling("completed", "active"));
});

test("cascade moves from skills pool to overflow, owner, then message capture", () => {
  const now = new Date("2026-10-08T12:00:00Z");
  const base = { now, severity: 2 as const, withinCoverage: true, managed: true };
  assert.deepEqual(cascadeDecision({ ...base, step: 0, slaDueAt: new Date(now.getTime() + 60_000), hasCandidate: true }), { action: "offer", step: 0, requireLanguage: true });
  assert.equal(cascadeDecision({ ...base, step: 0, slaDueAt: new Date(now.getTime() + 60_000), hasCandidate: false }).action, "advance");
  assert.equal(cascadeDecision({ ...base, step: 1, slaDueAt: new Date(now.getTime() + 60_000), hasCandidate: false }).action, "wait");
  assert.equal(cascadeDecision({ ...base, step: 1, slaDueAt: new Date(now.getTime() - 1), hasCandidate: true }).action, "advance");
  assert.equal(cascadeDecision({ ...base, step: 2, slaDueAt: new Date(now.getTime() - 1), hasCandidate: false }).action, "capture_message");
  assert.equal(cascadeDecision({ ...base, managed: false, step: 0, slaDueAt: now, hasCandidate: true }).action, "advance");
});

test("routing prefers language match, then longest idle, and respects capacity", () => {
  const candidate = (operatorId: string, languages: string[], idle: number, extra = {}) => ({ operatorId, languages, idleSince: new Date(idle), openVoice: 0, openChat: 0, maxVoice: 1, maxChat: 3, excluded: false, hasPendingOffer: false, ...extra });
  const pool = [candidate("a", ["en"], 100), candidate("b", ["en", "es"], 200), candidate("c", ["en"], 50, { openVoice: 1 })];
  assert.equal(selectOperator(pool, "voice", "en", true)?.operatorId, "a");
  assert.equal(selectOperator(pool, "voice", "es", true)?.operatorId, "b");
  assert.equal(selectOperator([candidate("a", ["en"], 1)], "voice", "es", true), null);
  assert.equal(selectOperator([candidate("a", ["en"], 1)], "voice", "es", false)?.operatorId, "a");
  assert.equal(selectOperator([candidate("a", ["en"], 1, { openVoice: 1 })], "chat", "en", false), null, "no chats during a call");
  assert.equal(selectOperator([candidate("a", ["en"], 1, { missed: true }), candidate("b", ["en"], 9)], "voice", "en", true)?.operatorId, "b", "missed offers yield to others");
  assert.equal(selectOperator([candidate("a", ["en"], 1, { missed: true })], "voice", "en", true)?.operatorId, "a", "but are re-rung when alone");
  assert.equal(selectOperator([candidate("a", ["en"], 1, { excluded: true })], "voice", "en", true), null, "declines are final");
});

test("authority, greeting, masking, coverage and wrap-up rules", () => {
  assert.equal(authorityFor({ quote: "allowed" }, "dispatch"), "not_allowed");
  assert.equal(renderGreeting("Thanks for calling {client_name}, this is {operator_first_name}.", { clientName: "Acme", operatorFirstName: "Sam", lineLabel: "Main" }), "Thanks for calling Acme, this is Sam.");
  assert.match(renderGreeting(null, { clientName: "Acme", operatorFirstName: "Sam", lineLabel: "Main" }), /Acme/);
  assert.equal(maskPhone("+19195550190"), "••••••••0190");
  assert.match(maskSensitiveText("card 4111 1111 1111 1111 ok"), /\[masked •••1111\]/);
  const windows = [{ days: [1, 2, 3, 4, 5], start: "08:00", end: "18:00" }];
  assert.ok(withinWindows(windows, "America/New_York", new Date("2026-10-08T14:00:00Z")));
  assert.ok(!withinWindows(windows, "America/New_York", new Date("2026-10-08T23:30:00Z")));
  assert.ok(withinWindows([{ days: [4], start: "18:00", end: "08:00" }], "UTC", new Date("2026-10-09T03:00:00Z")), "overnight window");
  assert.deepEqual(validateWrapUp({ disposition: "resolved", clientNotes: "", operatorNotes: "" }, ["client_notes"]), ["This client requires notes for the owner."]);
  assert.equal(validateWrapUp({ disposition: "callback_scheduled", clientNotes: "x", operatorNotes: "" }, []).length, 1);
});

const databaseUrl = process.env.CALL_CENTER_TEST_DATABASE_URL;

test("MySQL desk workflow", { skip: !databaseUrl && "set CALL_CENTER_TEST_DATABASE_URL to run" }, async (t) => {
  process.env.CALL_CENTER_DATABASE_URL = databaseUrl;
  const mysql = (await import("mysql2/promise")).default;
  const parsed = new URL(databaseUrl!);
  const admin = await mysql.createConnection({ host: parsed.hostname, port: Number(parsed.port || 3306), user: decodeURIComponent(parsed.username), password: decodeURIComponent(parsed.password), database: parsed.pathname.slice(1), multipleStatements: true });
  const [tables] = await admin.query("SELECT table_name AS name, table_type AS type FROM information_schema.tables WHERE table_schema = DATABASE()");
  await admin.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const table of tables as Array<{ name: string; type: string }>) await admin.query(`DROP ${table.type === "VIEW" ? "VIEW" : "TABLE"} IF EXISTS \`${table.name}\``);
  await admin.query("SET FOREIGN_KEY_CHECKS = 1");
  await admin.query(await readFile(new URL("../mysql/migrations/202610080001_call_center.sql", import.meta.url), "utf8"));
  await admin.end();
  await promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/seed-call-center.ts", "--lead-email", "lead@everonn.test"], { env: { ...process.env, CALL_CENTER_DATABASE_URL: databaseUrl } });

  const { executeCommand } = await import("../features/call-center/server/commands");
  const { createEscalation, endFromCallerSide } = await import("../features/call-center/server/intake");
  const { loadSnapshot, loadWallboard } = await import("../features/call-center/server/snapshot");
  const { runSweep } = await import("../features/call-center/server/routing");
  const { verifyAuditChain } = await import("../features/call-center/server/unit");
  const { withDeskConnection, closeCallCenterPool } = await import("../lib/call-center-mysql");
  t.after(() => closeCallCenterPool());

  const actor = (email: string, userId: string) => ({ userId, memberId: userId, workspaceId: "ws_test", name: email, email, role: "agent" as const });
  const lead = { actor: actor("lead@everonn.test", "user_lead"), session: crypto.randomUUID() };
  const sam = { actor: actor("sam.operator@everonn.test", "user_sam"), session: crypto.randomUUID() };
  const ana = { actor: actor("ana.operator@everonn.test", "user_ana"), session: crypto.randomUUID() };
  const run = (who: typeof lead, type: Parameters<typeof executeCommand>[1]["type"], payload: Record<string, unknown> = {}, id = crypto.randomUUID()) => executeCommand(who.actor, { type, id, payload }, who.session) as Promise<Record<string, unknown>>;
  const snapshot = (who: typeof lead) => loadSnapshot(who.actor, who.session);
  const service = { type: "service" as const, id: "test-runtime" };
  const acmeCall = (overrides: Record<string, unknown> = {}) => createEscalation(service, {
    channel: "voice", dialedE164: "+19195550100", caller: { e164: "+15551230100", name: "Maria", language: "en" }, triggerCode: "caller_requested_human", severity: 2,
    aiSummary: "Locked out of a 2018 Civic.", serviceLabel: "Car lockout", captured: [{ field: "address", value: "12 Oak St", confidence: 0.97, confirmed: true }],
    transcript: [{ speaker: "caller", text: "Can I talk to someone?" }], ...overrides,
  });

  for (const who of [lead, sam, ana]) {
    await run(who, "session.start");
    await snapshot(who);
    await run(who, "shift.start", { checks: { microphone: true, network: true, noticesAcknowledged: true } });
  }

  await t.test("intake offers to exactly one granted, available operator", async () => {
    const created = await acmeCall();
    assert.equal(created.status, "escalated");
    const views = await Promise.all([snapshot(lead), snapshot(sam), snapshot(ana)]);
    assert.equal(views.reduce((sum, view) => sum + view.offers.length, 0), 1);
    assert.equal(views[2].offers.length, 0, "Ana has no Acme grant");
    assert.ok(!views[2].queue.some((item) => item.clientName === "Acme Locksmith"), "ungranted clients never appear in the queue");
  });

  let acmeHandling = "";
  let acmeTenant = "";
  let owner: typeof lead = lead;
  await t.test("acceptance is atomic and checks the client lock", async () => {
    owner = (await snapshot(lead)).offers.length ? lead : sam;
    const offer = (await snapshot(owner)).offers[0];
    acmeTenant = offer.client.tenantId;
    assert.equal(offer.client.name, "Acme Locksmith");
    assert.match(offer.greeting.text, /Acme Locksmith/);
    assert.equal(offer.line.label, "Main line");
    const bright = (await snapshot(lead)).queue.find((item) => item.clientName === "Bright Plumbing");
    const otherTenant = bright?.tenantId || (await loadWallboard(lead.actor)).clients.find((client) => client.name === "Bright Plumbing")!.tenantId;
    await assert.rejects(run(owner, "offer.accept", { offer_id: offer.offerId, tenant_id: otherTenant }), { code: "client_mismatch" });
    const results = await Promise.allSettled([
      run(owner, "offer.accept", { offer_id: offer.offerId, tenant_id: acmeTenant }),
      run(owner, "offer.accept", { offer_id: offer.offerId, tenant_id: acmeTenant }),
    ]);
    const accepted = results.filter((result) => result.status === "fulfilled");
    assert.equal(accepted.length, 1, "first acceptance wins");
    acmeHandling = String((accepted[0] as PromiseFulfilledResult<Record<string, unknown>>).value.handling_id);
    const view = await snapshot(owner);
    assert.equal(view.active[0].state, "connecting");
    assert.equal(view.operator.presence, "on_call");
  });

  await t.test("authority matrix is enforced server-side", async () => {
    const base = { handling_id: acmeHandling, tenant_id: acmeTenant };
    await run(owner, "call.connected", base);
    await run(owner, "greeting.delivered", base);
    await assert.rejects(run(owner, "authority.act", { ...base, capability: "quote", detail: "Caller wants $" }), { code: "authority_denied" });
    assert.equal((await run(owner, "authority.act", { ...base, capability: "dispatch", detail: "Send Jordan now" })).outcome, "approval_requested");
    assert.equal((await run(owner, "authority.act", { ...base, capability: "book", detail: "Booked 9pm" })).outcome, "done");
  });

  await t.test("idempotent commands and versioned request edits", async () => {
    const view = await snapshot(owner);
    const request = view.active[0].request!;
    const payload = { handling_id: acmeHandling, tenant_id: acmeTenant, request_id: request.id, version: request.version, fields: [{ field: "safety_status", value: "Safe, in a store", confirmed: true }] };
    const first = await run(owner, "request.update", payload, "idem-request-update-1");
    const again = await run(owner, "request.update", payload, "idem-request-update-1");
    assert.deepEqual(first, again);
    await assert.rejects(run(owner, "request.update", payload), { code: "invalid_state" }, "stale version rejected");
    await assert.rejects(run(owner, "request.update", { ...payload, version: request.version + 1, fields: [{ field: "ssn", value: "x" }] }), { code: "forbidden" });
  });

  await t.test("wrap-up enforces client fields, meters minutes and frees the operator", async () => {
    const base = { handling_id: acmeHandling, tenant_id: acmeTenant };
    await run(owner, "call.hold", base);
    await run(owner, "call.resume", base);
    await run(owner, "call.end", base);
    assert.equal((await snapshot(owner)).operator.presence, "wrap_up");
    await assert.rejects(run(owner, "wrapup.submit", { ...base, disposition: "resolved" }), { code: "invalid_input" });
    await run(owner, "wrapup.submit", { ...base, disposition: "resolved", client_notes: "Booked lockout at 12 Oak St.", operator_notes: "" });
    const view = await snapshot(owner);
    assert.equal(view.active.length, 0);
    assert.equal(view.operator.presence, "available");
    assert.equal(view.stats.handledToday, 1);
    const [usage] = await withDeskConnection((tx) => tx.rows<{ meter: string }>("SELECT meter FROM usage_events"));
    assert.equal(usage.meter, "hitl_minutes");
  });

  await t.test("declines and timeouts cascade to the next operator", async () => {
    const created = await acmeCall({ caller: { e164: "+15551230111", name: "James", language: "en" } });
    assert.equal(created.status, "escalated");
    const first = (await snapshot(lead)).offers.length ? lead : sam;
    const second = first === lead ? sam : lead;
    const offer = (await snapshot(first)).offers[0];
    await run(first, "offer.decline", { offer_id: offer.offerId, tenant_id: offer.client.tenantId, reason: "headset issue" });
    const next = (await snapshot(second)).offers[0];
    assert.ok(next, "offered to the other granted operator");
    await withDeskConnection((tx) => tx.run("UPDATE call_offers SET expires_at = offered_at + INTERVAL 1 MICROSECOND, offered_at = offered_at - INTERVAL 1 MINUTE WHERE outcome = 'pending'"));
    await runSweep(true);
    const [offerRow] = await withDeskConnection((tx) => tx.rows<{ outcome: string }>("SELECT outcome FROM call_offers WHERE id = ?", [toBinaryId("ofr", next.offerId)]));
    assert.equal(offerRow.outcome, "timed_out");
    await endFromCallerSide(service, { tenantId: next.client.tenantId, escalationId: next.escalation.id, reasonCode: "caller_left" });
  });

  await t.test("unknown lines never resolve to a client", async () => {
    const created = await acmeCall({ dialedE164: "+19995550000" });
    assert.equal(created.status, "unknown_line");
    const conflicting = await acmeCall({ signaling: { to: "+19195550100", diversion: ["+13125550140"] } });
    assert.equal(conflicting.status, "unknown_line", "forwarding headers that disagree are not guessed");
    assert.ok((await snapshot(lead)).queue.some((item) => item.kind === "unknown_line" && item.tenantId === null));
  });

  await t.test("revoking a grant moves the operator out of a live interaction", async () => {
    await run(lead, "presence.set", { status: "away" });
    await acmeCall({ caller: { e164: "+15551230122", name: "Priya", language: "en" } });
    const offer = (await snapshot(sam)).offers[0];
    assert.ok(offer, "Sam is the only available Acme operator");
    const accepted = await run(sam, "offer.accept", { offer_id: offer.offerId, tenant_id: offer.client.tenantId });
    const samOperator = (await snapshot(sam)).operator.operatorId;
    assert.equal((await run(lead, "grant.revoke", { operator_id: samOperator, tenant_id: offer.client.tenantId })).moved_out, 1);
    const view = await snapshot(sam);
    assert.equal(view.active.length, 0);
    assert.ok(!view.queue.some((item) => item.tenantId === offer.client.tenantId));
    await assert.rejects(run(sam, "call.connected", { handling_id: accepted.handling_id, tenant_id: offer.client.tenantId }), { code: "not_granted" });
  });

  await t.test("tenant-scoped keys make cross-client references impossible", async () => {
    await withDeskConnection(async (tx) => {
      const [acmeEscalation] = await tx.rows<{ tenant_id: Buffer; id: Buffer; conversation_id: Buffer }>("SELECT e.tenant_id, e.id, e.conversation_id FROM escalations e JOIN tenants t ON t.id = e.tenant_id WHERE t.slug = 'acme-locksmith-demo' LIMIT 1");
      const [brightLine] = await tx.rows<{ id: Buffer }>("SELECT ce.id FROM channel_endpoints ce JOIN tenants t ON t.id = ce.tenant_id WHERE t.slug = 'bright-plumbing-demo' LIMIT 1");
      const [operator] = await tx.rows<{ id: Buffer }>("SELECT id FROM operators LIMIT 1");
      await assert.rejects(tx.run(
        "INSERT INTO desk_handlings (tenant_id, id, escalation_id, conversation_id, line_id, operator_id, channel, state, offered_at) VALUES (?,?,?,?,?,?, 'voice', 'accepted', UTC_TIMESTAMP(3))",
        [acmeEscalation.tenant_id, newId("hdl").bytes, acmeEscalation.id, acmeEscalation.conversation_id, brightLine.id, operator.id],
      ), { code: "ER_NO_REFERENCED_ROW_2" });
    });
  });

  await t.test("a second desk window supersedes the first", async () => {
    const replacement = { ...ana, session: crypto.randomUUID() };
    await run(replacement, "session.start");
    assert.equal((await snapshot(ana)).superseded, true);
    await assert.rejects(run(ana, "presence.set", { status: "break" }), { code: "session_superseded" });
  });

  await t.test("the audit log hash chain verifies", async () => {
    const result = await withDeskConnection((tx) => verifyAuditChain(tx));
    assert.equal(result.ok, true);
    assert.ok(result.checked > 10);
  });
});
