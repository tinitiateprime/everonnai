import test from "node:test";
import assert from "node:assert/strict";
import { createDemoWorkspace } from "@/features/everonn/demo-data";
import { composeAgentContext } from "@/features/agent-runtime/prompt-composer";
import { loadSkill } from "@/features/agent-runtime/skill-loader";
import { loadEvaluationSuite, parseEvaluationCases } from "@/features/agent-runtime/evaluations";
import { workflowAvailability } from "@/features/agent-runtime/tool-registry";
import { buildVoiceSessionVariables } from "@/features/voice-agent/session-prompt";
import { generateAssistantReply } from "@/features/voice-agent/gemini";
import { EMPTY_WEBSITE_PREFERENCES, saveWebsiteMemory, validateMemoryScope } from "@/features/agent-runtime/memory";
import { parseDomainReferenceCatalog } from "@/features/agent-runtime/references";

test("registered source notes have provenance and cannot add unapproved URLs or malformed content", () => {
  const text = loadSkill("sources:hvac").text;
  const catalog = parseDomainReferenceCatalog(text, "hvac");
  assert.equal(catalog.length, 3);
  assert.ok(catalog.every((item) => item.contentProvided && !item.fetchedAtRuntime && item.verifiedOn === "2026-10-06"));
  assert.throws(() => parseDomainReferenceCatalog(text.replaceAll("www.cdc.gov", "private.example.com"), "hvac"), /Unapproved/);
  assert.throws(() => parseDomainReferenceCatalog(text.replace('"verifiedOn": "2026-10-06"', '"verifiedOn": "unverified"'), "hvac"), /Invalid/);
  assert.throws(() => parseDomainReferenceCatalog(text.replace('"summary": "EPA', '"unsafe": true, "summary": "EPA'), "hvac"), /Invalid/);
  assert.throws(() => parseDomainReferenceCatalog(text + '\n- Duplicate: https://www.epa.gov/indoor-air-quality-iaq\n', "hvac"), /Duplicate/);
});

test("evaluation datasets fail closed and cannot enter the production instruction allowlist", () => {
  const suite = loadEvaluationSuite();
  assert.equal(suite.trace.length, 4);
  assert.equal(suite.cases.length, 18);
  assert.equal(suite.cases.filter((item) => item.check === "live-assistant").length, 2);
  assert.throws(() => parseEvaluationCases("No JSON cases"), /JSON case block/);
  assert.throws(() => parseEvaluationCases('```json\n[{"id":"evil.case","check":"execute-shell"}]\n```'), /Unknown/);
  assert.throws(() => parseEvaluationCases('```json\n[{"id":"same.case","check":"safety"},{"id":"same.case","check":"safety"}]\n```'), /required|duplicate/);
  assert.throws(() => loadSkill("evaluation:hvac" as Parameters<typeof loadSkill>[0]), /arbitrary paths/);
  const prompt = composeAgentContext({ profile: createDemoWorkspace().profile, capabilities: ["assistant"] });
  for (const item of suite.cases) assert.ok(!prompt.systemInstruction.includes(item.id) && !prompt.context.includes(item.id));
});

test("ElevenLabs receives the same compiled policy and task-scoped, connection-accurate catalog", () => {
  const profile = createDemoWorkspace().profile;
  const readonly = workflowAvailability(profile, ["https://www.googleapis.com/auth/calendar.readonly"]);
  const voice = buildVoiceSessionVariables(profile, false, readonly);
  assert.equal(voice.approved_instructions, voice.faq_notes);
  assert.match(voice.faq_notes, /Approved memory policy/);
  assert.match(voice.faq_notes, /APPLICATION_WORKFLOWS/);
  assert.match(voice.faq_notes, /DOMAIN_REFERENCE_CATALOG/);
  assert.equal(voice.calendar_connected, "false");
  assert.doesNotMatch(voice.faq_notes, /"id":"website.generate"/);
  assert.throws(() => buildVoiceSessionVariables(profile, true, { ...readonly, workspaceId: "another-business" }), /Cross-workspace/);
});

test("safety and missing-slot replies do not wait for connection resolution or paid requests", async () => {
  const profile = createDemoWorkspace().profile;
  let connections = 0, requests = 0;
  for (const message of ["I smell gas. Book tomorrow", "Book tomorrow"]) {
    const result = await generateAssistantReply(profile, [{ role: "caller", text: message }], { workspaceId: profile.workspaceId, feature: "website_chat" }, {
      resolveActions: async () => { connections++; throw new Error("Connection unavailable"); },
      fetchImpl: async () => { requests++; throw new Error("Provider unavailable"); },
    });
    assert.ok(["safety escalation", "request clarification"].includes(result.model));
  }
  assert.equal(connections, 0); assert.equal(requests, 0);
  await assert.rejects(generateAssistantReply(profile, [{ role: "caller", text: "Hello" }], { workspaceId: "other-business", feature: "website_chat" }), /Cross-workspace/);
});

test("stored memory is bounded and rejects secret-shaped content and hidden fields", () => {
  const profile = createDemoWorkspace().profile;
  const actor = { workspaceId: profile.workspaceId, userId: "owner", role: "owner" as const };
  const records = saveWebsiteMemory({ profile, actor, preferences: EMPTY_WEBSITE_PREFERENCES });
  assert.throws(() => saveWebsiteMemory({ profile, actor, preferences: EMPTY_WEBSITE_PREFERENCES, changeRequest: "AIza" + "x".repeat(35) }), /credentials/);
  const hidden = structuredClone(records);
  Object.assign(hidden[0].value, { private_customer: "Must not reach a prompt" });
  assert.throws(() => validateMemoryScope(hidden, profile.workspaceId), /workspace scope/);
  assert.throws(() => validateMemoryScope([...records, ...records], profile.workspaceId), /Duplicate/);
  const overflow = structuredClone(records);
  overflow[0].requests = Array.from({ length: 21 }, () => ({ text: "Old preference", at: new Date().toISOString() }));
  assert.throws(() => validateMemoryScope(overflow, profile.workspaceId), /workspace scope/);
});
