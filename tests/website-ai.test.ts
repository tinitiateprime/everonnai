import assert from "node:assert/strict";
import test from "node:test";
import { createDemoWorkspace } from "../features/everonn/demo-data";
import { generateDeterministicWebsiteSpec } from "./fixtures/website";
import { generateWebsiteSpec } from "../features/website-studio/ai-generator";
import { readWebsiteGeneration } from "../features/website-studio/progress";
import { createWebsiteProject } from "../features/website-studio/generator";

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

test("Gemini failures are reported instead of silently generating template content", async () => {
  const profile = createDemoWorkspace().profile;
  await assert.rejects(
    generateWebsiteSpec(profile, {
      config: { apiKey: "test-key", models: ["broken-model"], timeoutMs: 10_000, retryDelayMs: 0 },
      fetchImpl: (async () => new Response(JSON.stringify({ error: { message: "Provider unavailable" } }), { status: 503 })) as typeof fetch,
    }),
    /Gemini could not generate.*Provider unavailable/,
  );
});

test("unsupported content is repaired once using the failed grounding check", async () => {
  const profile = createDemoWorkspace().profile;
  const valid = generateDeterministicWebsiteSpec(profile);
  const invalid = structuredClone(valid);
  invalid.seo.description = "Certified heating and cooling inspections.";
  let requests = 0;
  const result = await generateWebsiteSpec(profile, {
    config: { apiKey: "test-key", models: ["test-model"], timeoutMs: 10_000, retryDelayMs: 0 },
    fetchImpl: (async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      requests++;
      if (requests === 2) {
        assert.equal(body.contents[1].role, "model");
        assert.equal(JSON.parse(body.contents[1].parts[0].text).seo.description, invalid.seo.description);
        assert.match(body.contents[2].parts[0].text, /Remove unsupported claims: Certified/);
        assert.match(body.contents[2].parts[0].text, /Do not change service IDs\/names, invent evidence/);
      }
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(requests === 1 ? invalid : valid) }] } }] });
    }) as typeof fetch,
  });
  assert.equal(requests, 2);
  assert.equal(result.spec.seo.description, valid.seo.description);
});

test("persistent grounding failures stop after one repair and identify the rejected claim", async () => {
  const profile = createDemoWorkspace().profile;
  const invalid = generateDeterministicWebsiteSpec(profile);
  invalid.services[0].pageHeadline = "Certified HVAC System Inspections";
  let requests = 0;
  await assert.rejects(generateWebsiteSpec(profile, {
    config: { apiKey: "test-key", models: ["test-model"], timeoutMs: 10_000, retryDelayMs: 0 },
    fetchImpl: (async () => {
      requests++;
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(invalid) }] } }] });
    }) as typeof fetch,
  }), /grounding QA.*Remove unsupported claims: Certified/);
  assert.equal(requests, 2);
});

test("generation progress survives split JSON/UTF-8 chunks and requires a final result", async () => {
  const profile = createDemoWorkspace().profile;
  const project = createWebsiteProject(profile, generateDeterministicWebsiteSpec(profile));
  const wire = new TextEncoder().encode([
    JSON.stringify({ type: "progress", progress: { stage: "content", message: "Planning café content" } }),
    JSON.stringify({ type: "heartbeat" }),
    JSON.stringify({ type: "progress", progress: { stage: "code", message: "Building pages", completedPages: 21, totalPages: 51 } }),
    JSON.stringify({ type: "result", data: { project } }),
  ].join("\n"));
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    for (let index = 0; index < wire.length; index += 7) controller.enqueue(wire.slice(index, index + 7));
    controller.close();
  } });
  const messages: string[] = [];
  const result = await readWebsiteGeneration(new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } }), (progress) => messages.push(progress.message));
  assert.equal(result.project?.id, project.id);
  assert.deepEqual(messages, ["Planning café content", "Building pages"]);
  await assert.rejects(readWebsiteGeneration(new Response('{"type":"heartbeat"}\n', { headers: { "Content-Type": "application/x-ndjson" } }), () => {}), /interrupted before completion/);
  await assert.rejects(readWebsiteGeneration(new Response('{"type":"error","error":"The contact page timed out."}\n', { headers: { "Content-Type": "application/x-ndjson" } }), () => {}), /contact page timed out/);
});
