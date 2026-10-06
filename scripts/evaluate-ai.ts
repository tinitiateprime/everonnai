import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createDemoWorkspace } from "../features/everonn/demo-data";
import { composeAgentContext } from "../features/agent-runtime/prompt-composer";
import { availableWorkflows, workflowAvailability } from "../features/agent-runtime/tool-registry";
import { EMPTY_WEBSITE_PREFERENCES, forgetWebsiteMemory, saveWebsiteMemory } from "../features/agent-runtime/memory";
import { loadEvaluationSuite, type EvaluationCase } from "../features/agent-runtime/evaluations";
import { preventUnverifiedActionClaim } from "../features/agent-runtime/safety";
import { generateDeterministicWebsiteSpec } from "../tests/fixtures/website";
import { runWebsiteQa } from "../features/website-studio/generator";
import type { BusinessProfile } from "../features/everonn/types";

const scopes = ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.events.freebusy", "https://www.googleapis.com/auth/gmail.send"];

function fictionalProfile(): BusinessProfile {
  const profile = createDemoWorkspace().profile;
  return { ...profile, workspaceId: "isolated_runtime_evaluation", businessName: "EverOnn Evaluation Heating", email: "team@example.com",
    pricingRules: "No numeric prices are approved. Ask the team for an actual quote.", knowledge: [], skillId: "hvac" as const, domainSkillIds: [] };
}

function checkReply(item: EvaluationCase, reply: string) {
  for (const text of item.includes || []) assert.ok(reply.toLowerCase().includes(text.toLowerCase()), `${item.id}: missing required response content`);
  for (const text of item.excludes || []) assert.ok(!reply.toLowerCase().includes(text.toLowerCase()), `${item.id}: forbidden response content`);
}

export async function runEvaluationCase(item: EvaluationCase, live = false) {
  const profile = fictionalProfile();
  const actor = { workspaceId: profile.workspaceId, role: "owner" as const, userId: "evaluation-owner" };
  switch (item.check) {
    case "runtime-boundaries": {
      profile.knowledge.push({ id: "hidden", category: "faq", question: "Private?", answer: "EVAL_UNAPPROVED_FACT", approved: false, updatedAt: new Date().toISOString() });
      const runtime = composeAgentContext({ profile, capabilities: ["assistant", "appointment-booking"] });
      const website = composeAgentContext({ profile, capabilities: ["website-building"] });
      for (const context of [runtime, website]) {
        assert.ok(context.trace.some((asset) => asset.id === "plugins"));
        assert.ok(context.trace.some((asset) => asset.id === "memory"));
        assert.ok(context.trace.some((asset) => asset.id === "sources:hvac"));
        assert.ok(context.trace.every((asset) => /^\d+\.\d+\.\d+$/.test(asset.version) && /^[a-f0-9]{64}$/.test(asset.digest)));
        assert.doesNotMatch(context.systemInstruction, /https:\/\/www\.(?:epa|cdc|energy)\.gov/);
        assert.match(context.context, /"contentProvided":true/);
        assert.match(context.context, /"fetchedAtRuntime":false/);
        assert.match(context.context, /EPA identifies pollution-source control/);
        assert.doesNotMatch(context.context + context.systemInstruction, /EVAL_UNAPPROVED_FACT|assistant\.live-business-facts|website\.memory-forget-and-concurrency/);
      }
      return;
    }
    case "provider-availability": {
      const disabled = availableWorkflows(profile.workspaceId, ["assistant", "appointment-booking"]);
      assert.ok(disabled.filter((tool) => tool.id.startsWith("calendar.") || tool.id.startsWith("gmail.")).every((tool) => !tool.available));
      const connected = workflowAvailability(profile, scopes);
      assert.ok(availableWorkflows(profile.workspaceId, ["assistant"], connected).every((tool) => tool.available));
      const readonly = workflowAvailability(profile, ["https://www.googleapis.com/auth/calendar.readonly"]);
      const catalog = availableWorkflows(profile.workspaceId, ["assistant"], readonly);
      assert.equal(catalog.find((tool) => tool.id === "calendar.check_availability")?.available, true);
      assert.equal(catalog.find((tool) => tool.id === "calendar.create_appointment")?.available, false);
      assert.equal(availableWorkflows(profile.workspaceId, ["assistant"], workflowAvailability(profile, scopes, false)).find((tool) => tool.id.startsWith("gmail."))?.available, false);
      assert.throws(() => composeAgentContext({ profile, capabilities: ["assistant"], actions: { ...connected, workspaceId: "other-business" } }), /Cross-workspace/);
      assert.ok(availableWorkflows(profile.workspaceId, ["website-building"], connected).every((tool) => tool.id === "website.generate"));
      return;
    }
    case "domain-selection": {
      const selected = composeAgentContext({ profile, capabilities: ["assistant"] });
      assert.ok(selected.trace.some((asset) => asset.id === "sources:hvac"));
      const general = composeAgentContext({ profile: { ...profile, skillId: "general", businessType: "HVAC" }, capabilities: ["assistant"] });
      assert.ok(!general.trace.some((asset) => asset.id.includes("hvac")));
      assert.doesNotMatch(general.context, /www\.cdc\.gov/);
      return;
    }
    case "memory-lifecycle": {
      let records = saveWebsiteMemory({ profile, actor, scope: "workspace", preferences: { ...EMPTY_WEBSITE_PREFERENCES, brief: "Business default" }, expectedRevision: null });
      records = saveWebsiteMemory({ profile, actor, records, preferences: { ...EMPTY_WEBSITE_PREFERENCES, brief: "Website choice" }, changeRequest: "Use green instead", expectedRevision: null });
      const project = records.find((record) => record.scope === "project")!;
      assert.match(composeAgentContext({ profile, capabilities: ["website-building"], memory: records }).context, /Use green instead/);
      assert.doesNotMatch(composeAgentContext({ profile, capabilities: ["assistant"], memory: records }).context, /Use green instead/);
      assert.throws(() => composeAgentContext({ profile: { ...profile, workspaceId: "other-business" }, capabilities: ["website-building"], memory: records }), /workspace scope/);
      assert.throws(() => forgetWebsiteMemory({ profile, records, actor, scope: "project", expectedRevision: null }), /changed/);
      for (const role of ["agent", "viewer"] as const) assert.throws(() => forgetWebsiteMemory({ profile, records, actor: { ...actor, role }, scope: "project", expectedRevision: project.revision }), /cannot perform/);
      const forgotten = forgetWebsiteMemory({ profile, records, actor, scope: "project", expectedRevision: project.revision });
      assert.equal(forgotten.length, 1);
      assert.equal(forgotten[0].scope, "workspace");
      assert.doesNotMatch(composeAgentContext({ profile, capabilities: ["website-building"], memory: forgotten }).context, /Use green instead/);
      assert.throws(() => saveWebsiteMemory({ profile, actor, preferences: { ...EMPTY_WEBSITE_PREFERENCES, brief: "ghp_" + "x".repeat(36) } }), /credentials/);
      return;
    }
    case "confirmation-filter": {
      const reply = preventUnverifiedActionClaim(item.message!);
      assert.notEqual(reply, item.message);
      checkReply(item, reply);
      return;
    }
    case "website-grounding": {
      const spec = generateDeterministicWebsiteSpec(profile);
      assert.ok(runWebsiteQa(spec, profile).passed);
      spec.services.push({ ...spec.services[0], id: "unsupported", name: "Inactive furnace installation" });
      assert.equal(runWebsiteQa(spec, profile).passed, false);
      const unapproved = generateDeterministicWebsiteSpec(profile);
      unapproved.about.body += " We are award-winning.";
      assert.equal(runWebsiteQa(unapproved, profile).passed, false);
      return;
    }
    case "safety":
    case "booking-clarification": {
      const { generateAssistantReply } = await import("../features/voice-agent/gemini");
      const reply = await generateAssistantReply(profile, [{ role: "caller", text: item.message! }], { workspaceId: profile.workspaceId, feature: "website_chat" }, {
        resolveActions: async () => { throw new Error("Provider connection lookup must not run before this response."); },
        fetchImpl: async () => { throw new Error("This case must not call a provider."); },
      });
      assert.equal(reply.model, item.check === "safety" ? "safety escalation" : "request clarification");
      checkReply(item, reply.reply);
      return;
    }
    case "live-assistant": {
      if (!live) throw new Error("Live evaluation requires explicit --live.");
      const { generateAssistantReply } = await import("../features/voice-agent/gemini");
      const { getGeminiWebsiteConfig } = await import("../lib/provider-config");
      const config = getGeminiWebsiteConfig();
      const reply = await generateAssistantReply(profile, [{ role: "caller", text: item.message! }], { workspaceId: profile.workspaceId, feature: "website_chat" }, {
        actions: workflowAvailability(profile), config: { ...config, models: config.models.slice(0, 2), retryDelayMs: 0 },
      });
      assert.ok(reply.reply.trim());
      checkReply(item, reply.reply);
      assert.doesNotMatch(reply.reply, /\$\s*\d|\b\d+(?:\.\d+)?\s*(?:USD|dollars?)\b/i, "Unapproved numeric price");
      return { model: reply.model, reply: reply.reply };
    }
  }
}

async function main() {
  const flags = process.argv.slice(2);
  if (flags.some((flag) => flag !== "--live")) throw new Error("Only --live is supported; it makes small real Gemini requests with fictional data.");
  const live = flags.includes("--live");
  if (live) (await import("@next/env")).loadEnvConfig(process.cwd());
  // Isolate even unexpected provider attempts from customer storage and billing views.
  const usageDir = await mkdtemp(path.join(tmpdir(), "everonn-ai-evaluation-usage-"));
  for (const key of ["SUPABASE_DB_URL", "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_USAGE_SCHEMA", "AWS_LAMBDA_FUNCTION_NAME", "NETLIFY_BLOBS_CONTEXT"]) process.env[key] = "";
  process.env.NETLIFY = "false"; process.env.EVERONN_USAGE_DIR = usageDir;
  process.env.USAGE_REQUIRE_DURABLE_STORAGE = "false"; process.env.EVERONN_REQUIRE_DURABLE_STORAGE = "false";
  process.env.USAGE_BACKGROUND_MODE = "external";
  const suite = loadEvaluationSuite();
  let passed = 0, skipped = 0;
  for (const item of suite.cases) {
    if (item.check === "live-assistant" && !live) { skipped++; continue; }
    const result = await runEvaluationCase(item, live);
    passed++;
    console.log(`PASS ${item.id}${result ? ` (${result.model})` : ""}`);
    if (result) console.log(result.reply);
  }
  console.log(JSON.stringify({ passed, skippedLiveCases: skipped, datasetVersions: suite.trace, isolatedProviderUsage: live ? usageDir : undefined,
    scope: "Runtime wiring and selected scenarios; full audio/golden-dataset/visual/customer acceptance gates remain separate." }));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    let message = error instanceof Error ? error.message : "AI evaluation failed.";
    for (const key of [process.env.GEMINI_API_KEY, process.env.GOOGLE_API_KEY]) if (key) message = message.replaceAll(key, "[redacted]");
    console.error(message); process.exitCode = 1;
  });
}
