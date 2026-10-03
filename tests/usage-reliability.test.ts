import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { finalizeUsage, memoryUsageCount, replayUsageOutbox } from "../features/usage/delivery";
import { conversationUsage, eligibleUsageSessions } from "../features/usage/elevenlabs";
import { estimateGeminiCost } from "../features/usage/pricing";
import { geminiTokens, meteredGeminiRequest } from "../features/usage/gemini";
import { verifyElevenLabsSignature } from "../features/usage/webhook";
import { runUsageWorker } from "../features/usage/worker";
import { importGeminiUsage } from "../features/usage/import";
import { importElevenLabsUsage } from "../features/usage/import-elevenlabs";
import { billingQuery, billingRows, summarizeBilling, syncGeminiBilling } from "../features/usage/billing";
import { summarizeUsage } from "../features/usage/summary";
import { authorizedUsageJob } from "../features/usage/job-auth";
import { createUsageSession, enqueueUsage, readGeminiBilling, readUsageEvents, readUsageOutbox, readUsageSession, readUsageSessions, readUsageWorkerState, recordUsage, saveUsageSession } from "../lib/usage-store";
import { POST as webhookPOST } from "../app/api/usage/elevenlabs/webhook/route";
import type { UsageEvent } from "../features/usage/types";

const secret = "test-secret-with-at-least-32-characters";
const event = (id = "request_1"): UsageEvent => ({ id, workspaceId: "workspace_1", provider: "gemini", feature: "website_chat", kind: "request", operation: "generateContent", model: "gemini-3.8-flash", status: "success", startedAt: new Date().toISOString(), recordedAt: new Date().toISOString(), latencyMs: 20, httpStatus: 200, tokens: geminiTokens({ usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 30, thoughtsTokenCount: 20, cachedContentTokenCount: 40, totalTokenCount: 150 } }), voice: null });
async function withStore(run: () => Promise<void>) {
  const directory = await mkdtemp(path.join(tmpdir(), "everonn-usage-reliability-"));
  const overrides: Record<string, string> = { EVERONN_USAGE_DIR: directory, SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SECRET_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "", SUPABASE_USAGE_SCHEMA: "", SUPABASE_DB_URL: "", NETLIFY: "false", NETLIFY_BLOBS_CONTEXT: "", AWS_LAMBDA_FUNCTION_NAME: "", USAGE_REQUIRE_DURABLE_STORAGE: "false", ELEVENLABS_API_KEY: "fixture-key", ELEVENLABS_AGENT_ID: "agent_1", ELEVENLABS_WEBHOOK_SECRET: secret, USAGE_CRON_SECRET: secret, GEMINI_BILLING_SERVICE_ACCOUNT_BASE64: "", GEMINI_BILLING_TABLE: "", GEMINI_BILLING_WORKSPACE_ID: "" };
  const previous = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  try { await run(); }
  finally {
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    await rm(directory, { recursive: true, force: true });
  }
}
const conversation = (userId: string, id = "conv_fixture") => ({ agent_id: "agent_1", conversation_id: id, user_id: userId, status: "done", metadata: { start_time_unix_secs: Math.floor(Date.now() / 1000), call_duration_secs: 60, cost: 250, cost_fiat: 0.05 } });
function sign(raw: string, timestamp = Math.floor(Date.now() / 1000)) {
  return `t=${timestamp},v0=${createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex")}`;
}

test("transient writes retry without issuing another Gemini request", async () => {
  let calls = 0, writes = 0;
  const saved: UsageEvent[] = [];
  await meteredGeminiRequest("gemini-3.8-flash", "fixture", {}, { usage: { workspaceId: "workspace_1", feature: "website_chat" }, record: async (record) => { writes++; if (writes === 1 || writes === 3) throw new Error("transient write failure"); saved.push(record); }, fetchImpl: (async () => { calls++; return Response.json({ responseId: "provider_response", usageMetadata: { promptTokenCount: 10, totalTokenCount: 20 } }); }) as typeof fetch });
  assert.equal(calls, 1);
  assert.equal(saved.at(-1)?.tokens?.total, 20);
  assert.equal(saved.at(-1)?.providerResponseId, "provider_response");
});

test("durable outbox and in-process fallback recover totals without double-counting", async () => withStore(async () => {
  const record = event();
  await recordUsage({ ...record, status: "pending", tokens: null });
  const log = console.error; console.error = () => undefined;
  try {
    await finalizeUsage(record, { record: async () => { throw new Error("ledger unavailable"); }, enqueue: enqueueUsage });
    assert.equal((await readUsageOutbox()).length, 1);
    assert.equal((await readUsageEvents(record.workspaceId))[0].tokens, null);
    await replayUsageOutbox();
    await enqueueUsage(record);
    await replayUsageOutbox();
    assert.equal((await readUsageEvents(record.workspaceId)).length, 1);
    assert.equal((await readUsageEvents(record.workspaceId))[0].tokens?.total, 150);
    const memory = event("memory_retry");
    await finalizeUsage(memory, { record: async () => { throw new Error(); }, enqueue: async () => { throw new Error(); } });
    assert.equal(memoryUsageCount(record.workspaceId), 1);
    await replayUsageOutbox();
    assert.equal(memoryUsageCount(record.workspaceId), 0);
    assert.equal((await readUsageEvents(record.workspaceId)).length, 2);
  } finally { console.error = log; }
}));

test("signed webhook rejects tampering, stale and future signatures and unknown identities", async () => withStore(async () => {
  const id = await createUsageSession({ workspaceId: "workspace_1", feature: "dashboard_voice" }, "agent_1");
  const raw = JSON.stringify({ type: "post_call_transcription", data: { ...conversation(id), transcript: [{ message: "customer-private-text" }] } });
  assert.equal(verifyElevenLabsSignature(raw, sign(raw), secret), true);
  assert.equal(verifyElevenLabsSignature(`${raw} `, sign(raw), secret), false);
  assert.equal(verifyElevenLabsSignature(raw, sign(raw, Math.floor(Date.now() / 1000) - 1801), secret), false);
  assert.equal(verifyElevenLabsSignature(raw, sign(raw, Math.floor(Date.now() / 1000) + 120), secret), false);
  for (let attempt = 0; attempt < 2; attempt++) assert.equal((await webhookPOST(new Request("https://app.example/api/usage/elevenlabs/webhook", { method: "POST", body: raw, headers: { "elevenlabs-signature": sign(raw) } }))).status, 200);
  const records = await readUsageEvents("workspace_1");
  assert.equal(records.length, 1);
  assert.equal(records[0].voice?.credits, 250);
  assert.equal(JSON.stringify(records).includes("customer-private-text"), false);
  assert.equal((await readUsageSessions("workspace_2")).length, 0);
  assert.equal((await webhookPOST(new Request("https://app.example", { method: "POST", body: raw, headers: { "elevenlabs-signature": "t=0,v0=bad" } }))).status, 401);
  const unknown = JSON.stringify({ type: "post_call_transcription", data: conversation("unknown") });
  assert.equal((await webhookPOST(new Request("https://app.example", { method: "POST", body: unknown, headers: { "elevenlabs-signature": sign(unknown) } }))).status, 200);
  assert.equal((await readUsageEvents("workspace_1")).length, 1);
}));

test("unattended worker recovers callbacks older than 24 hours across workspaces", async () => withStore(async () => {
  const tickets: Record<string, string> = {};
  for (const workspaceId of ["workspace_1", "workspace_2"]) {
    const id = await createUsageSession({ workspaceId, feature: "dashboard_voice" }, "agent_1");
    const session = (await readUsageSession(id))!;
    await saveUsageSession({ ...session, createdAt: new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString() });
    tickets[`conv_${workspaceId}`] = id;
  }
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/conversations")) {
      const userId = url.searchParams.get("user_id");
      const id = Object.keys(tickets).find((value) => tickets[value] === userId)!;
      return Response.json({ conversations: [{ conversation_id: id }], has_more: false });
    }
    const id = url.pathname.split("/").at(-1)!;
    return Response.json(conversation(tickets[id], id));
  }) as typeof fetch;
  const result = await runUsageWorker(fetchImpl);
  assert.equal(result.checked, 2);
  assert.equal(result.error, null);
  for (const workspaceId of ["workspace_1", "workspace_2"]) assert.equal((await readUsageEvents(workspaceId))[0].voice?.credits, 250);
  assert.ok((await readUsageWorkerState())?.lastFinishedAt);
  assert.equal((await runUsageWorker(fetchImpl)).checked, 0);
  const delayed = (await readUsageSessions("workspace_1"))[0];
  assert.equal(eligibleUsageSessions([{ ...delayed, complete: false, nextSyncAt: new Date(Date.now() + 60_000).toISOString() }]).length, 0);
}));

test("late webhook cannot replace newer provider charges and triggers an authoritative recheck", async () => withStore(async () => {
  const id = await createUsageSession({ workspaceId: "workspace_1", feature: "dashboard_voice" }, "agent_1");
  const session = (await readUsageSession(id))!;
  const oldCheck = new Date(Date.now() - 60_000).toISOString();
  await saveUsageSession({ ...session, conversationIds: ["conv_fixture"], complete: true, syncedAt: oldCheck, providerCheckedAt: oldCheck });
  const latest = { ...conversation(id), metadata: { ...conversation(id).metadata, cost: 500, cost_fiat: .10 } };
  await recordUsage(conversationUsage(session, latest));
  const raw = JSON.stringify({ type: "post_call_transcription", data: conversation(id) });
  assert.equal((await webhookPOST(new Request("https://app.example", { method: "POST", body: raw, headers: { "elevenlabs-signature": sign(raw) } }))).status, 200);
  assert.equal((await readUsageEvents("workspace_1"))[0].voice?.credits, 500, "an older delivered payload must not lower newer provider totals");
  assert.equal(eligibleUsageSessions(await readUsageSessions("workspace_1")).length, 1, "a complete ticket must still recheck a new webhook");
  const corrected = { ...latest, metadata: { ...latest.metadata, cost: 600, cost_fiat: .12 } };
  await runUsageWorker((async (url: string | URL | Request) => String(url).includes("/conversations?") ? Response.json({ conversations: [{ conversation_id: "conv_fixture" }], has_more: false }) : Response.json(corrected)) as typeof fetch);
  assert.equal((await readUsageEvents("workspace_1"))[0].voice?.credits, 600);
  assert.equal(eligibleUsageSessions(await readUsageSessions("workspace_1")).length, 0);
}));

test("failed provider checks back off and session completion cannot erase a newer conversation", async () => withStore(async () => {
  const id = await createUsageSession({ workspaceId: "workspace_1", feature: "dashboard_voice" }, "agent_1");
  const session = (await readUsageSession(id))!;
  assert.ok((await runUsageWorker((async () => new Response("{}", { status: 401 })) as typeof fetch)).error);
  const failed = (await readUsageSession(id))!;
  assert.ok(failed.syncError);
  assert.ok(Date.parse(failed.nextSyncAt!) > Date.now());
  await saveUsageSession({ ...failed, complete: true, conversationIds: ["old"] });
  await saveUsageSession({ ...failed, complete: false, conversationIds: ["old", "new"] });
  await saveUsageSession({ ...failed, complete: true, conversationIds: ["old"] });
  assert.equal((await readUsageSession(id))?.complete, false);
  assert.deepEqual((await readUsageSession(id))?.conversationIds, ["old", "new"]);
  await assert.rejects(saveUsageSession({ ...session, feature: "website_voice" }), /scope mismatch/);
}));

test("Gemini prices cache once, includes thinking and applies long-context and dated rates", () => {
  const tokens = event().tokens!;
  assert.equal(estimateGeminiCost("gemini-3.8-flash", tokens, { tier: "paid", timestamp: "2026-10-03" }).usd, (60 * .75 + 40 * .075 + 50 * 3.75) / 1e6);
  assert.equal(estimateGeminiCost("gemini-3.8-flash", tokens, { tier: "paid", timestamp: "2027-01-01" }).usd, (60 * 1.5 + 40 * .15 + 50 * 7.5) / 1e6);
  assert.equal(estimateGeminiCost("gemini-2.5-pro", { ...tokens, input: 200001, cached: 0, total: 200051 }, { tier: "paid", timestamp: "2026-10-03" }).usd, (200001 * 2.5 + 50 * 15) / 1e6);
  assert.equal(estimateGeminiCost("unknown-model", tokens, { tier: "paid" }).usd, null);
  assert.equal(estimateGeminiCost("gemini-3.8-flash", null).usd, null);
  assert.equal(estimateGeminiCost("gemini-3.8-flash", { ...tokens, cached: 101 }).usd, null);
  assert.equal(estimateGeminiCost("gemini-3.8-flash", tokens, { tier: "free" }).usd, 0);
  assert.match(estimateGeminiCost("gemini-3.8-flash", tokens, { tier: "list-price" }).basis, /unverified/);
});

test("Gemini history import repairs a timeout once and rejects conflicting or cross-workspace matches", async () => withStore(async () => {
  const pending = { ...event(), tokens: null, status: "failed" as const };
  await recordUsage(pending);
  const input = { version: 1, workspaceId: pending.workspaceId, records: [{ eventId: pending.id, responseId: "provider_export_1", startedAt: pending.startedAt, model: pending.model, feature: pending.feature, httpStatus: 200, usageMetadata: { promptTokenCount: 10, totalTokenCount: 30 } }] };
  assert.equal((await importGeminiUsage(input)).applied, 0);
  assert.equal((await readUsageEvents(pending.workspaceId))[0].tokens, null);
  await importGeminiUsage(input, true);
  await importGeminiUsage(input, true);
  assert.equal((await readUsageEvents(pending.workspaceId)).length, 1);
  assert.equal((await readUsageEvents(pending.workspaceId))[0].tokens?.total, 30);
  await assert.rejects(importGeminiUsage({ ...input, workspaceId: "workspace_2" }, true), /not found/);
  await assert.rejects(importGeminiUsage({ ...input, records: [{ ...input.records[0], usageMetadata: { totalTokenCount: 999 } }] }, true), /conflicts/);
  await assert.rejects(recordUsage({ ...event("another_request"), workspaceId: "workspace_2", providerResponseId: "provider_export_1" }), /already assigned/);
}));

test("legacy ElevenLabs imports read provider costs and cannot steal identified conversations", async () => withStore(async () => {
  const input = { version: 1, workspaceId: "workspace_1", feature: "dashboard_voice", agentId: "agent_1", conversationIds: ["conv_old"] };
  const fetchImpl = (async () => Response.json({ ...conversation("", "conv_old"), user_id: null })) as typeof fetch;
  await importElevenLabsUsage(input, false, fetchImpl);
  assert.equal((await readUsageEvents("workspace_1")).length, 0);
  await importElevenLabsUsage(input, true, fetchImpl);
  await importElevenLabsUsage(input, true, fetchImpl);
  assert.equal((await readUsageEvents("workspace_1")).length, 1);
  assert.equal((await readUsageEvents("workspace_1"))[0].voice?.credits, 250);
  assert.equal((await readUsageSessions("workspace_1")).length, 1, "re-importing a legacy conversation must not issue another tracking session");
  await assert.rejects(importElevenLabsUsage({ ...input, workspaceId: "workspace_2" }, true, fetchImpl), /already assigned/);
  const foreign = await createUsageSession({ workspaceId: "workspace_2", feature: "dashboard_voice" }, "agent_1");
  await assert.rejects(importElevenLabsUsage(input, true, (async () => Response.json(conversation(foreign, "conv_old"))) as typeof fetch), /cannot be attributed/);
}));

test("billing exports are parameterized, preserve provider currency/refunds, and stay scoped", async () => withStore(async () => {
  const query = billingQuery("billing-project.dataset.export_table", "dedicated-project", "service-id", "Asia/Kolkata");
  assert.match(query.query, /project.id = @projectId AND service.id = @serviceId/);
  assert.ok(query.queryParameters.some((parameter) => parameter.parameterValue.value === "dedicated-project"));
  assert.throws(() => billingQuery("bad`table", "x", "y", "UTC"), /Invalid/);
  assert.equal(billingRows({ rows: [{ f: [{ v: "2026-10-03" }, { v: "USD" }, { v: "-0.25" }] }] })[0].amount, -.25);
  assert.throws(() => billingRows({ rows: [{ f: [{ v: "2026-10-03" }, { v: "USD" }, { v: null as unknown as string }] }] }), /Invalid/);
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const keys = { GEMINI_BILLING_SERVICE_ACCOUNT_BASE64: Buffer.from(JSON.stringify({ client_email: "billing@billing-project.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) })).toString("base64"), GEMINI_BILLING_TABLE: "billing-project.dataset.export_table", GEMINI_BILLING_PROJECT_ID: "dedicated-project", GEMINI_BILLING_SERVICE_ID: "service-id", GEMINI_BILLING_WORKSPACE_ID: "workspace_1", GEMINI_BILLING_TIME_ZONE: "UTC" };
  const old = Object.fromEntries(Object.keys(keys).map((key) => [key, process.env[key]])); Object.assign(process.env, keys);
  let calls = 0;
  try {
    const result = await syncGeminiBilling((async (url: string | URL | Request) => { calls++; return String(url).includes("oauth2") ? Response.json({ access_token: "fixture-token" }) : Response.json({ jobComplete: true, rows: [{ f: [{ v: new Date().toISOString().slice(0, 10) }, { v: "USD" }, { v: ".25" }] }] }); }) as typeof fetch);
    assert.equal(result.error, null);
    const report = (await readGeminiBilling("workspace_1"))!;
    assert.equal(summarizeBilling(report, "workspace_1", "today").totals[0].amount, .25);
    assert.throws(() => summarizeBilling(report, "workspace_2", "today"), /scope mismatch/);
    assert.equal(await readGeminiBilling("workspace_2"), null);
    await syncGeminiBilling((async () => { throw new Error("must use hourly cache"); }) as typeof fetch);
    assert.equal(calls, 2);
  } finally { for (const [key, value] of Object.entries(old)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
}));

test("untracked chart days differ from zero and scheduled jobs require the server secret", async () => withStore(async () => {
  const tracked = event();
  tracked.startedAt = new Date(new Date().setUTCHours(12, 0, 0, 0)).toISOString();
  const summary = summarizeUsage([tracked], [], { workspaceId: "workspace_1", timeZone: "UTC", period: "7d", now: new Date(new Date().setUTCHours(23, 0, 0, 0)) });
  assert.equal(summary.daily[0].coverage, "untracked");
  assert.equal(summary.daily.at(-1)?.coverage, "partial");
  const older = { ...tracked, id: "historical", historical: true, startedAt: new Date(Date.parse(tracked.startedAt) - 3 * 24 * 60 * 60_000).toISOString() };
  const withHistory = summarizeUsage([tracked, older], [], { workspaceId: "workspace_1", timeZone: "UTC", period: "7d", now: new Date(new Date().setUTCHours(23, 0, 0, 0)) });
  assert.equal(withHistory.daily[0].coverage, "untracked");
  assert.equal(withHistory.daily[3].coverage, "imported");
  assert.equal(withHistory.daily[4].coverage, "untracked", "one imported day must not invent complete tracking between then and today");
  assert.equal(withHistory.trackingStartedAt, tracked.startedAt);
  assert.equal(authorizedUsageJob(new Request("https://app.example", { headers: { authorization: `Bearer ${secret}` } })), true);
  assert.equal(authorizedUsageJob(new Request("https://app.example", { headers: { authorization: "Bearer wrong" } })), false);
  process.env.USAGE_REQUIRE_DURABLE_STORAGE = "true";
  await assert.rejects(recordUsage(event("not_durable")), /Durable usage storage is required/);
}));
