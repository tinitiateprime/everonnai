import test from "node:test";
import assert from "node:assert/strict";
import { createDemoWorkspace } from "@/features/everonn/demo-data";
import { composeAgentContext } from "@/features/agent-runtime/prompt-composer";
import { loadSkill } from "@/features/agent-runtime/skill-loader";
import { EMPTY_WEBSITE_PREFERENCES, retrieveWebsiteMemory, saveWebsiteMemory, validateMemoryScope } from "@/features/agent-runtime/memory";
import { immediateSafetyReply, preventUnverifiedActionClaim } from "@/features/agent-runtime/safety";
import { readableInk } from "@/features/website-studio/brand";
import { generateWebsiteSpec } from "@/features/website-studio/ai-generator";
import { runWebsiteQa } from "@/features/website-studio/generator";
import { generateDeterministicWebsiteSpec } from "./fixtures/website";
import { generateAssistantReply } from "@/features/voice-agent/gemini";

const profile = () => createDemoWorkspace().profile;
const actor = () => ({ workspaceId: profile().workspaceId, role: "owner" as const, userId: "owner-a" });
const config = { apiKey: "test-key", models: ["test-model"], timeoutMs: 10_000, retryDelayMs: 0 };

test("runtime composes registered HVAC and shared capabilities; excludes unapproved knowledge", () => {
  const business = profile();
  business.knowledge.push({ id: "private", category: "faq", question: "Hidden?", answer: "UNAPPROVED_SECRET", approved: false, updatedAt: new Date().toISOString() });
  const context = composeAgentContext({ profile: business, capabilities: ["assistant", "appointment-booking"] });
  assert.ok(context.trace.some((trace) => trace.id === "domain:hvac"));
  assert.ok(context.trace.some((trace) => trace.id === "capability:appointment-booking"));
  assert.ok(context.trace.every((trace) => /^1\.\d+\.\d+$/.test(trace.version) && trace.digest.length === 64));
  assert.doesNotMatch(context.context, /UNAPPROVED_SECRET/);
  business.skillId = "general";
  assert.ok(!composeAgentContext({ profile: business, capabilities: ["assistant"] }).trace.some((trace) => trace.id === "domain:hvac"));
  assert.throws(() => loadSkill("../../private" as Parameters<typeof loadSkill>[0]), /arbitrary paths/);
});

test("owner website edits persist, have optimistic concurrency, and cannot cross tenants", () => {
  const business = profile();
  const memory = saveWebsiteMemory({ profile: business, actor: actor(), preferences: { ...EMPTY_WEBSITE_PREFERENCES, brief: "Premium black and gold", rejected: ["Technician stock photos"] }, changeRequest: "Make it black and gold with equipment images", expectedRevision: null });
  assert.equal(memory[0].scope, "project");
  assert.equal(memory[0].value.imagery, "equipment");
  assert.equal(retrieveWebsiteMemory(memory, "other-business").length, 0);
  assert.equal(retrieveWebsiteMemory(memory, business.workspaceId, "different-project").length, 0);
  assert.throws(() => validateMemoryScope(memory, "other-business"), /workspace scope/);
  assert.throws(() => saveWebsiteMemory({ records: memory, profile: business, actor: actor(), preferences: memory[0].value, expectedRevision: null }), /changed/);
  for (const role of ["viewer", "agent"] as const) assert.throws(() => saveWebsiteMemory({ profile: business, actor: { ...actor(), role }, preferences: EMPTY_WEBSITE_PREFERENCES }), /cannot perform/);
  assert.throws(() => saveWebsiteMemory({ profile: business, actor: { ...actor(), workspaceId: "other-business" }, preferences: EMPTY_WEBSITE_PREFERENCES }), /Cross-workspace/);
  const pinned = saveWebsiteMemory({ records: memory, profile: business, actor: actor(), preferences: { ...memory[0].value, primaryColor: "#000000", accentColor: "#D4AF37" }, expectedRevision: memory[0].revision });
  const revised = saveWebsiteMemory({ records: pinned, profile: business, actor: actor(), preferences: pinned[0].value, changeRequest: "Use green instead", expectedRevision: pinned[0].revision });
  assert.equal(revised.length, 1);
  assert.equal(revised[0].requests.length, 2);
  assert.equal(revised[0].value.primaryColor, "");
  assert.equal(revised[0].requests.at(-1)?.text, "Use green instead");
  const website = composeAgentContext({ profile: business, capabilities: ["website-building"], memory: revised });
  assert.match(website.context, /Use green instead/);
  assert.doesNotMatch(composeAgentContext({ profile: business, capabilities: ["assistant"], memory: revised }).context, /Use green instead/);
});

test("domain IDs and design controls cannot grant paths, services, or unsafe rendering", () => {
  const business = profile();
  assert.throws(() => saveWebsiteMemory({ profile: business, actor: actor(), preferences: { ...EMPTY_WEBSITE_PREFERENCES, priorityServiceId: "invented-emergency" } }), /active business service/);
  assert.throws(() => saveWebsiteMemory({ profile: business, actor: actor(), preferences: { ...EMPTY_WEBSITE_PREFERENCES, primaryColor: "url(x)" } }), /hex website colors/);
  assert.equal(readableInk("#ffffff"), "#111111");
  assert.equal(readableInk("#000000"), "#ffffff");
});

test("safety precedes routine booking and text cannot confirm unexecuted actions", () => {
  assert.match(immediateSafetyReply("I smell gas by my furnace. Book tomorrow") || "", /emergency service/);
  assert.match(immediateSafetyReply("My carbon monoxide alarm is going off") || "", /do not attempt repairs/);
  assert.equal(immediateSafetyReply("My AC is not cooling"), null);
  assert.equal(immediateSafetyReply("No gas smell, just a noisy fan"), null);
  assert.match(preventUnverifiedActionClaim("Your appointment is confirmed for tomorrow"), /only after/);
  assert.equal(preventUnverifiedActionClaim("Which exact time would you prefer?"), "Which exact time would you prefer?");
});

test("real assistant entry point prioritizes safety over missing appointment details without calling a provider", async () => {
  const result = await generateAssistantReply(profile(), [{ role: "caller", text: "I smell gas by the furnace. Book tomorrow." }], { workspaceId: profile().workspaceId, feature: "website_chat" });
  assert.equal(result.model, "safety escalation");
  assert.match(result.reply, /emergency service/);
});

test("new exact color controls remain authoritative when saved alongside a matching design request", () => {
  const memory = saveWebsiteMemory({ profile: profile(), actor: actor(), preferences: { ...EMPTY_WEBSITE_PREFERENCES, primaryColor: "#111111", accentColor: "#D4AF37" }, changeRequest: "Make it premium black and gold" });
  assert.equal(memory[0].value.primaryColor, "#111111");
  assert.equal(memory[0].value.accentColor, "#D4AF37");
});

test("Gemini receives Markdown and scoped preferences; content plan and exact owner colors survive", async () => {
  const business = profile();
  const memory = saveWebsiteMemory({ profile: business, actor: actor(), preferences: { ...EMPTY_WEBSITE_PREFERENCES, primaryColor: "#111111", accentColor: "#D4AF37", hiddenSections: ["gallery"] } });
  const generated = generateDeterministicWebsiteSpec(business);
  let body: Record<string, unknown> = {};
  const result = await generateWebsiteSpec(business, { config, memory, fetchImpl: (async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(generated) }] } }] });
  }) as typeof fetch });
  assert.match(JSON.stringify(body.systemInstruction), /Website building/);
  assert.match(JSON.stringify(body.contents), /D4AF37/);
  assert.equal(result.spec.visualDirection.primaryColor, "#111111");
  assert.equal(result.spec.design?.rationale, generated.design?.rationale);
  assert.doesNotMatch(JSON.stringify(body.generationConfig), /hero.*split|immersive|centered/);
  assert.ok(result.skills.some((skill) => skill.id === "domain:hvac"));
});

test("unsupported raw model services and unapproved credentials fail grounding", async () => {
  const business = profile();
  const generated = generateDeterministicWebsiteSpec(business);
  generated.services.push({ ...generated.services[0], id: "invented", name: "Emergency furnace installation" });
  await assert.rejects(generateWebsiteSpec(business, { config, fetchImpl: (async () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(generated) }] } }] })) as typeof fetch }), /unsupported or duplicate services/);
  const clean = generateDeterministicWebsiteSpec(business);
  business.knowledge.push({ id: "unapproved", category: "faq", question: "Awards", answer: "award-winning", approved: false, updatedAt: "2026-10-05" });
  clean.about.body += " We are award-winning.";
  assert.equal(runWebsiteQa(clean, business).passed, false);
});
