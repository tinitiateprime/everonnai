import assert from "node:assert/strict";
import test from "node:test";
import { createDemoWorkspace } from "../features/everonn/demo-data";
import { generateDeterministicWebsiteSpec } from "../features/website-studio/generator";
import { generateWebsiteSpec } from "../features/website-studio/ai-generator";

test("Gemini website output remains grounded and preserves approved services", async () => {
  const profile = createDemoWorkspace().profile;
  const generated = generateDeterministicWebsiteSpec(profile);
  generated.hero.headline = "Comfort starts with a clear next step.";
  const fetchImpl = async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(generated) }] } }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });

  const result = await generateWebsiteSpec(profile, {
    config: { apiKey: "test-key", models: ["test-model"], timeoutMs: 10_000, retryDelayMs: 0 },
    fetchImpl: fetchImpl as typeof fetch,
  });

  assert.equal(result.provider, "gemini");
  assert.equal(result.model, "test-model");
  assert.equal(result.spec.hero.headline, "Comfort starts with a clear next step.");
  assert.deepEqual(result.spec.services.map((service) => service.name), profile.services.filter((service) => service.active).map((service) => service.name));
});

test("Gemini failures fall back to the deterministic safe generator", async () => {
  const profile = createDemoWorkspace().profile;
  const result = await generateWebsiteSpec(profile, {
    config: { apiKey: "test-key", models: ["broken-model"], timeoutMs: 10_000, retryDelayMs: 0 },
    fetchImpl: (async () => new Response(JSON.stringify({ error: { message: "Provider unavailable" } }), { status: 503 })) as typeof fetch,
  });

  assert.equal(result.provider, "deterministic");
  assert.match(result.fallbackReason || "", /Provider unavailable/);
  assert.equal(result.spec.services.length, profile.services.filter((service) => service.active).length);
});
