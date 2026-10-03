import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { hasCapability } from "../features/auth/rbac";
import { geminiTokens, meteredGeminiRequest } from "../features/usage/gemini";
import { conversationUsage, syncUsageSession } from "../features/usage/elevenlabs";
import { summarizeUsage, usageTotals } from "../features/usage/summary";
import type { UsageEvent, UsageSession } from "../features/usage/types";
import { createUsageSession, readUsageEvents, readUsageSession, readUsageSessions, recordUsage } from "../lib/usage-store";
import { createDemoWorkspace } from "../features/everonn/demo-data";
import { generateWebsiteSpec } from "../features/website-studio/ai-generator";
import { generateDeterministicWebsiteSpec } from "../features/website-studio/generator";

const now = new Date("2026-10-03T10:00:00Z");
function request(overrides: Partial<UsageEvent> = {}): UsageEvent {
  return { id: "event_1", workspaceId: "workspace_1", provider: "gemini", feature: "website_generation", kind: "request", operation: "generateContent", model: "test-model", status: "success", startedAt: "2026-10-02T20:00:00Z", recordedAt: now.toISOString(), latencyMs: 20, httpStatus: 200, tokens: geminiTokens({ usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 30, cachedContentTokenCount: 80, totalTokenCount: 150 } }), voice: null, ...overrides };
}
const session: UsageSession = { id: "opaque-session", workspaceId: "workspace_1", feature: "dashboard_voice", agentId: "agent_1", createdAt: now.toISOString(), conversationIds: [], syncedAt: null, complete: false };
const providerConversation = (overrides = {}) => ({ agent_id: "agent_1", conversation_id: "conv_1", user_id: session.id, status: "done", metadata: { start_time_unix_secs: now.getTime() / 1000, call_duration_secs: 90, cost: 350, cost_fiat: 0.07, charging: { tts_usage: { total_characters: 200, total_audio_output_seconds: 30 }, asr_usage: { total_audio_input_seconds: 20 } } }, ...overrides });

test("Gemini tokens preserve the provider total without double-counting cached input", () => {
  assert.equal(request().tokens?.total, 150);
  assert.equal(request().tokens?.cached, 80);
  assert.equal(geminiTokens({}), null);
  assert.equal(geminiTokens({ usageMetadata: { totalTokenCount: -1, candidatesTokenCount: "10" } }), null);
  assert.equal(geminiTokens({ usageMetadata: { totalTokenCount: 0 } })?.total, 0);
});

test("each Gemini HTTP or network attempt is recorded, including usage returned on errors", async () => {
  const records = new Map<string, UsageEvent>();
  const record = async (event: UsageEvent) => { records.set(event.id, event); };
  const usage = { workspaceId: "workspace_1", feature: "website_chat" as const };
  for (const status of [200, 429]) {
    await meteredGeminiRequest("model", "secret-not-recorded", {}, { usage, record, fetchImpl: (async () => new Response(JSON.stringify({ usageMetadata: { totalTokenCount: 15 } }), { status })) as typeof fetch });
  }
  await assert.rejects(meteredGeminiRequest("model", "secret", {}, { usage, record, fetchImpl: (async () => { throw new Error("network timeout"); }) as typeof fetch }), /network timeout/);
  assert.equal(records.size, 3);
  const events = [...records.values()];
  assert.deepEqual(events.map((event) => event.status), ["success", "failed", "failed"]);
  assert.equal(usageTotals(events).totalTokens, 30);
  assert.equal(usageTotals(events).failedRequests, 2);
  assert.equal(JSON.stringify(events).includes("secret"), false);
});

test("metering storage failure after a provider response does not cause a second call", async () => {
  let writes = 0;
  let calls = 0;
  const originalLog = console.error;
  console.error = () => undefined;
  try {
    const result = await meteredGeminiRequest("model", "secret", {}, {
      usage: { workspaceId: "workspace_1", feature: "website_chat" },
      record: async () => { if (++writes > 1) throw new Error("storage failed"); },
      fetchImpl: (async () => { calls++; return new Response("{}"); }) as typeof fetch,
    });
    assert.equal(result.response.status, 200);
    assert.equal(calls, 1);
    await assert.rejects(meteredGeminiRequest("model", "secret", {}, {
      usage: { workspaceId: "workspace_1", feature: "website_chat" }, record: async () => { throw new Error("storage failed"); },
      fetchImpl: (async () => { calls++; return new Response("{}"); }) as typeof fetch,
    }), /storage failed/);
    assert.equal(calls, 1, "no unmetered provider call when the initial durable write fails");
  } finally { console.error = originalLog; }
});

test("ElevenLabs reconciliation validates both provider agent and opaque identity", () => {
  const event = conversationUsage(session, providerConversation());
  assert.equal(event.voice?.credits, 350);
  assert.equal(event.voice?.costUsd, 0.07);
  assert.equal(event.voice?.durationSeconds, 90);
  assert.equal(event.voice?.ttsCharacters, 200);
  assert.equal(conversationUsage(session, providerConversation()).id, event.id);
  assert.throws(() => conversationUsage(session, providerConversation({ user_id: "another-workspace" })), /does not belong/);
  assert.throws(() => conversationUsage(session, providerConversation({ agent_id: "another-agent" })), /does not belong/);
  const pending = conversationUsage(session, providerConversation({ status: "processing" }));
  assert.equal(pending.status, "pending");
  assert.equal(pending.voice?.credits, null);
  assert.equal(conversationUsage(session, providerConversation({ metadata: { call_duration_secs: 0, cost: 0, cost_fiat: 0 } })).voice?.credits, 0);
});

test("unknown totals stay unavailable and failed calls are not presented as zero usage", () => {
  const unknown = request({ tokens: null, status: "failed" });
  assert.equal(usageTotals([unknown]).totalTokens, null);
  assert.equal(usageTotals([unknown]).unreportedTokenRequests, 1);
  assert.equal(usageTotals([request(), unknown]).totalTokens, 150);
  assert.equal(usageTotals([]).totalTokens, 0);
});

test("usage periods use the business timezone and reject mixed workspace data", () => {
  const summary = summarizeUsage([request(), request({ id: "older", startedAt: "2026-10-02T17:59:00Z" })], [], { workspaceId: "workspace_1", timeZone: "Asia/Kolkata", period: "today", now });
  assert.equal(summary.totals.requests, 1, "20:00 UTC is Oct 3 in Kolkata; 17:59 UTC is Oct 2");
  assert.equal(summary.daily[0].date, "2026-10-03");
  assert.equal(summary.totals.totalTokens, 150);
  assert.throws(() => summarizeUsage([request({ workspaceId: "workspace_2" })], [], { workspaceId: "workspace_1", timeZone: "UTC", period: "all", now }), /scope mismatch/);
});

test("live chat duration is separated from voice minutes; actual charges include both", () => {
  const voice = conversationUsage(session, providerConversation());
  const chat = { ...voice, id: "chat", feature: "elevenlabs_chat" as const };
  const summary = summarizeUsage([request(), voice, chat], [], { workspaceId: "workspace_1", timeZone: "UTC", period: "month", now });
  assert.equal(summary.totals.voiceSeconds, 90);
  assert.equal(summary.totals.durationSeconds, 180);
  assert.equal(summary.totals.credits, 700);
  assert.equal(summary.features.find((entry) => entry.feature === "elevenlabs_chat")?.totals.conversations, 1);
});

test("only owners and managers may view provider usage", () => {
  assert.equal(hasCapability("owner", "usage:view"), true);
  assert.equal(hasCapability("manager", "usage:view"), true);
  assert.equal(hasCapability("agent", "usage:view"), false);
  assert.equal(hasCapability("viewer", "usage:view"), false);
});

test("durable usage survives retries, concurrent writes and discarded AI output", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "everonn-usage-test-"));
  const previous = { directory: process.env.EVERONN_USAGE_DIR, key: process.env.ELEVENLABS_API_KEY, netlify: process.env.NETLIFY, context: process.env.NETLIFY_BLOBS_CONTEXT };
  process.env.EVERONN_USAGE_DIR = directory;
  process.env.ELEVENLABS_API_KEY = "fixture-key";
  process.env.NETLIFY = "false";
  delete process.env.NETLIFY_BLOBS_CONTEXT;
  try {
    await Promise.all(Array.from({ length: 20 }, (_, index) => recordUsage(request({ id: `concurrent_${index}` }))));
    await recordUsage(request({ workspaceId: "workspace_2", id: "private" }));
    assert.equal((await readUsageEvents("workspace_1")).length, 20);
    assert.equal((await readUsageEvents("workspace_2")).length, 1);
    assert.deepEqual(await readUsageEvents("unknown"), []);
    assert.equal(await readUsageSession("../../auth"), null);
    const id = await createUsageSession({ workspaceId: "workspace_1", feature: "dashboard_voice" }, "agent_1");
    const stored = (await readUsageSession(id))!;
    assert.equal((await readUsageSessions("workspace_2")).length, 0);
    let pages = 0;
    const fetchImpl = (async (url: string | URL | Request) => {
      if (String(url).includes("/convai/conversations?")) {
        assert.ok(String(url).includes(`user_id=${id}`));
        pages++;
        return Response.json({ conversations: [{ conversation_id: "conv_fixture" }], has_more: false });
      }
      return Response.json(providerConversation({ conversation_id: "conv_fixture", user_id: id }));
    }) as typeof fetch;
    await syncUsageSession(stored, undefined, fetchImpl);
    await syncUsageSession(stored, "conv_fixture", fetchImpl);
    const metered = await readUsageEvents("workspace_1");
    assert.equal(pages, 1);
    assert.equal(metered.filter((event) => event.kind === "conversation").length, 1, "repeated sync updates the stable provider ID");
    assert.equal(usageTotals(metered).credits, 350, "credits must not be double-counted");
    const finalConversation = metered.find((event) => event.kind === "conversation")!;
    await recordUsage({ ...finalConversation, status: "pending", recordedAt: new Date(Date.now() + 1_000).toISOString(), voice: { ...finalConversation.voice!, credits: null, costUsd: null } });
    assert.equal((await readUsageEvents("workspace_1")).find((event) => event.id === finalConversation.id)?.voice?.credits, 350, "a delayed pending snapshot must not erase final charges");

    const profile = createDemoWorkspace().profile;
    const usage = { workspaceId: profile.workspaceId, feature: "website_generation" as const };
    let attempts = 0;
    await generateWebsiteSpec(profile, {
      usage, config: { apiKey: "fixture-key", models: ["bad-output", "good-output"], timeoutMs: 1000, retryDelayMs: 0 },
      fetchImpl: (async () => Response.json({ usageMetadata: { totalTokenCount: ++attempts * 100 }, candidates: [{ content: { parts: [{ text: JSON.stringify(attempts === 1 ? {} : generateDeterministicWebsiteSpec(profile)) }] } }] })) as typeof fetch,
    });
    const ai = await readUsageEvents(profile.workspaceId);
    assert.equal(ai.length, 2, "QA-discarded output still consumed provider tokens");
    assert.equal(usageTotals(ai).totalTokens, 300);
  } finally {
    for (const [name, value] of Object.entries({ EVERONN_USAGE_DIR: previous.directory, ELEVENLABS_API_KEY: previous.key, NETLIFY: previous.netlify, NETLIFY_BLOBS_CONTEXT: previous.context })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
