import test from "node:test";
import assert from "node:assert/strict";
import { makePlan, makeWebsite } from "../lib/generator";
import {
  completion,
  ProviderError,
  eligibleWebsiteModels,
  prioritizeModels,
  DEFAULT_WEBSITE_MODELS,
} from "../lib/openrouter";
import { apiKey, protectRequest } from "../lib/api";
import { brief, model, website } from "./fixtures";

const directions = [
  "Quiet warmth",
  "Mechanical precision",
  "Neighborhood comfort",
].map((name) => ({
  name,
  concept: `${name} is a thoughtful visual identity for home comfort services.`,
  palette: ["#203d25", "#f6f8ed", "#aac286"],
  typography: "Purposeful display typography and readable body copy",
  composition: `${name} has a unique editorial arrangement emphasizing business services and real contact details.`,
  imageQueries: ["heat pump equipment"],
}));
test("AI pipeline plans three variants, repairs output, restricts models to configuration and reports usage", async () => {
  const original = globalThis.fetch;
  const originalModels = process.env.OPENROUTER_MODELS;
  process.env.OPENROUTER_MODELS =
    "test/coder:free,test/second:free,test/third:free";
  const calls: Record<string, unknown>[] = [];
  let generations = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith("/models"))
      return Response.json({
        data: [
          model,
          { ...model, id: "test/second:free" },
          { ...model, id: "test/third:free" },
        ],
      });
    const body = JSON.parse(String(options?.body));
    calls.push(body);
    const isPlan = body.response_format?.json_schema?.name === "design_plan";
    const content = isPlan
      ? JSON.stringify({ directions })
      : ++generations === 1
        ? website().replace("</body>", "<script>alert(1)</script></body>")
        : website();
    return Response.json({
      model: body.model,
      choices: [{ finish_reason: "stop", message: { content } }],
      usage: { total_tokens: 700 },
    });
  };
  try {
    const plan = await makePlan("test-key", brief, null);
    assert.equal(plan.directions.length, 3);
    const artifact = await makeWebsite(
      "test-key",
      brief,
      null,
      plan.directions[0],
      0,
      [],
    );
    assert.equal(generations, 2);
    assert.equal(artifact.usage?.total_tokens, 700);
    assert.ok(artifact.html.includes("Content-Security-Policy"));
    assert.equal(artifact.model, model.id);
    assert.ok(
      calls.every((c) =>
        ["test/coder:free", "test/second:free", "test/third:free"].includes(
          String(c.model),
        ),
      ),
    );
    assert.ok(
      calls.every((c) => !JSON.stringify(c.provider).includes("max_price")),
    );
    assert.ok(JSON.stringify(calls[2]).includes("validation failure"));
    assert.ok(
      JSON.stringify(calls).includes("Website-building SKILL.md instructions"),
    );
    assert.ok(JSON.stringify(calls).includes("ownerKnowledge"));
    assert.ok(JSON.stringify(calls).includes("No fixed theme"));
  } finally {
    globalThis.fetch = original;
    if (originalModels === undefined) delete process.env.OPENROUTER_MODELS;
    else process.env.OPENROUTER_MODELS = originalModels;
  }
});
test("provider rejects truncated content and credentials without returning partial websites", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      Response.json({
        choices: [
          { finish_reason: "length", message: { content: "<!doctype html>" } },
        ],
      });
    await assert.rejects(
      completion("secret", model, [{ role: "user", content: "test" }]),
      /output limit/,
    );
    globalThis.fetch = async () =>
      new Response("unauthorized", { status: 401 });
    await assert.rejects(
      completion("secret", model, []),
      (error) => error instanceof ProviderError && error.status === 401,
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("same-origin mutation guard and environment-only API key rules", () => {
  assert.throws(
    () =>
      protectRequest(
        new Request("http://localhost:3000/api/plan", {
          headers: { origin: "https://attacker.example" },
        }),
        "test",
      ),
    /studio/,
  );
  const request = new Request("http://localhost:3000/api/plan", {
    headers: {
      origin: "http://localhost:3000",
      "x-openrouter-key": "sk-or-v1-test-key",
    },
  });
  protectRequest(request, "test");
  const originalKey = process.env.OPENROUTER_API_KEY;
  const originalToken = process.env.STUDIO_ACCESS_TOKEN;
  try {
    delete process.env.OPENROUTER_API_KEY;
    assert.throws(() => apiKey(request), /OPENROUTER_API_KEY/);
    process.env.OPENROUTER_API_KEY = "sk-or-v1-server-test";
    process.env.STUDIO_ACCESS_TOKEN = "test-studio-token";
    assert.throws(() => apiKey(request), /access token/);
    const authorized = new Request("http://localhost:3000/api/plan", {
      headers: {
        "x-openrouter-key": "sk-or-v1-browser-override",
        "x-studio-token": "test-studio-token",
      },
    });
    assert.equal(apiKey(authorized), "sk-or-v1-server-test");
    assert.throws(
      () =>
        apiKey(
          new Request("http://localhost:3000", {
            headers: { "x-studio-token": "wrong-token" },
          }),
        ),
      /access token/,
    );
  } finally {
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
    if (originalToken === undefined) delete process.env.STUDIO_ACCESS_TOKEN;
    else process.env.STUDIO_ACCESS_TOKEN = originalToken;
  }
});
test("only available configured models are selected, paid models and latest aliases are supported", () => {
  const available = eligibleWebsiteModels([
    model,
    ...DEFAULT_WEBSITE_MODELS.map((id) => ({ ...model, id })),
    {
      ...model,
      id: "test/paid",
      pricing: { prompt: "0.1", completion: "0.1" },
    },
  ]);
  assert.deepEqual(
    prioritizeModels(available, "")
      .slice(0, 3)
      .map((m) => m.id),
    DEFAULT_WEBSITE_MODELS,
  );
  assert.equal(
    prioritizeModels(available, "test/coder:free,missing/model:free")[0].id,
    model.id,
  );
  const missing = available.filter((m) => m.id !== DEFAULT_WEBSITE_MODELS[0]);
  assert.equal(prioritizeModels(missing, "")[0].id, DEFAULT_WEBSITE_MODELS[1]);
  assert.deepEqual(
    prioritizeModels(available, "test/paid").map((m) => m.id),
    ["test/paid"],
  );
  assert.deepEqual(prioritizeModels(available, "missing/model"), []);
  assert.equal(
    prioritizeModels(available, "anthropic/claude-opus-latest")[0].id,
    "~anthropic/claude-opus-latest",
  );
});
test("reasoning effort follows catalogue capabilities instead of unsupported defaults", async () => {
  const original = globalThis.fetch;
  let sent: Record<string, unknown> | undefined;
  globalThis.fetch = async (_url, options) => {
    sent = JSON.parse(String(options?.body));
    return Response.json({
      model: model.id,
      choices: [{ finish_reason: "stop", message: { content: "done" } }],
    });
  };
  try {
    await completion(
      "test-key",
      {
        ...model,
        supported_parameters: ["reasoning"],
        reasoning: { supported_efforts: ["high", "medium"] },
      },
      [],
    );
    assert.deepEqual(sent?.reasoning, { effort: "medium", exclude: true });
    await completion(
      "test-key",
      {
        ...model,
        supported_parameters: ["reasoning"],
        reasoning: { mandatory: false },
      },
      [],
    );
    assert.deepEqual(sent?.reasoning, { enabled: false, exclude: true });
    await completion(
      "test-key",
      {
        ...model,
        supported_parameters: ["reasoning"],
        reasoning: { mandatory: true, supports_max_tokens: true },
      },
      [],
    );
    assert.deepEqual(sent?.reasoning, { max_tokens: 3000, exclude: true });
  } finally {
    globalThis.fetch = original;
  }
});
