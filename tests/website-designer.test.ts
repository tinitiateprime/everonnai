import test from "node:test";
import assert from "node:assert/strict";
import {
  createDesign,
  validateDesign,
  type DesignBrief,
} from "../lib/builds/design";
import type { BlueprintDocument, Fact } from "../lib/knowledge/contracts";
import { model } from "./fixtures";

const blueprint = {
  pages: [
    { path: "/", title: "Openhouse Cafe", family: "home", outcome: "render" },
    { path: "/menu", title: "Menu", family: "service", outcome: "render" },
  ],
} as unknown as BlueprintDocument;
const facts = [
  { key: "business_name", value: "Openhouse Cafe" },
] as unknown as Fact[];
const brief: DesignBrief = {
  pages: [
    {
      path: "/",
      title: "Openhouse Cafe",
      family: "home",
      headings: ["Slow mornings, good coffee"],
      excerpt:
        "An eclectic cafe and lounge serving brunch, coffee and cocktails.",
    },
  ],
  agentPrompt: "Rebuild the cafe site mobile-first with a warm, relaxed feel.",
  customerGaps: "Visitors cannot find opening hours quickly.",
  corrections: ["We do not offer delivery."],
};
const themed = {
  name: "Morning Light",
  rationale: "A relaxed brunch cafe for locals: warm, unhurried and inviting.",
  context: {
    industry: "Cafe and lounge",
    audience: "Locals and visitors looking for a relaxed brunch spot",
    mood: ["warm", "relaxed", "handcrafted"],
    vibe: "Sunlit, unhurried and welcoming, like a slow weekend morning.",
  },
  theme: {
    palette: ["#f6efe4", "#3b2a20", "#c8693f", "#7d8f69"],
    typography: "Iowan Old Style serif headings with a rounded sans body",
    motif: "Soft wavy dividers and grain gradients",
  },
  navigation: "top",
  hero: "split",
  content: "cards",
  css: ':root{--cream:#f6efe4;--espresso:#3b2a20;--terracotta:#c8693f}body{background:var(--cream);color:var(--espresso);font-family:"Iowan Old Style",Georgia,serif}.hero{background:linear-gradient(135deg,#f6efe4,#ead9c2);padding:48px;border-radius:32px}.enquiry button{background:var(--terracotta);color:#fff;border-radius:999px}',
};

async function withProvider(
  content: unknown,
  task: (sent: { body?: Record<string, unknown> }) => Promise<void>,
) {
  const previous = {
    fetch: globalThis.fetch,
    key: process.env.OPENROUTER_API_KEY,
    models: process.env.OPENROUTER_MODELS,
    provider: process.env.WEBSITE_PROVIDER,
  };
  process.env.OPENROUTER_API_KEY = "sk-or-v1-test";
  process.env.OPENROUTER_MODELS = model.id;
  delete process.env.WEBSITE_PROVIDER;
  const sent: { body?: Record<string, unknown> } = {};
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/models"))
      return Response.json({ data: [model] });
    sent.body = JSON.parse(String(init?.body));
    return Response.json({
      model: model.id,
      choices: [
        {
          finish_reason: "stop",
          message: { content: JSON.stringify(content) },
        },
      ],
    });
  };
  try {
    await task(sent);
  } finally {
    globalThis.fetch = previous.fetch;
    for (const [name, value] of [
      ["OPENROUTER_API_KEY", previous.key],
      ["OPENROUTER_MODELS", previous.models],
      ["WEBSITE_PROVIDER", previous.provider],
    ] as const)
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
  }
}

test("website designer reads the business context and owner brief and returns a themed design", async () => {
  await withProvider(themed, async (sent) => {
    const result = await createDesign(
      blueprint,
      facts,
      1,
      [],
      undefined,
      model.id,
      brief,
    );
    assert.equal(result.mode, "live");
    assert.deepEqual(result.design.context?.mood, [
      "warm",
      "relaxed",
      "handcrafted",
    ]);
    assert.equal(result.design.theme?.palette[2], "#c8693f");
    const messages = sent.body!.messages as { content: string }[];
    assert.match(messages[0].content, /Website designer SKILL\.md/);
    assert.match(messages[0].content, /must not|Never a dim, lazy/);
    const payload = JSON.parse(messages[1].content);
    assert.equal(payload.ownerBrief.agentPrompt, brief.agentPrompt);
    assert.equal(
      payload.ownerBrief.whatTheCurrentSiteLacks,
      brief.customerGaps,
    );
    assert.deepEqual(payload.ownerCorrections, ["We do not offer delivery."]);
    assert.match(payload.pages[0].excerpt, /brunch, coffee and cocktails/);
    assert.equal(sent.body!.max_tokens, 16000);
  });
});

test("new designs must state their context and theme; earlier stored designs remain valid", async () => {
  const { context: _context, theme: _theme, ...untheme } = themed;
  void _context;
  void _theme;
  await withProvider(untheme, async () => {
    await assert.rejects(
      createDesign(blueprint, facts, 2, [], undefined, model.id, brief),
      /context and its theme/,
    );
  });
  await withProvider(
    { ...themed, theme: { ...themed.theme, palette: ["warm brown"] } },
    async () => {
      await assert.rejects(
        createDesign(blueprint, facts, 2, [], undefined, model.id, brief),
      );
    },
  );
  // Designs accepted before context-aware theming still load for existing builds.
  assert.equal(validateDesign(untheme).name, "Morning Light");
});

test("a design with a squeezed layout is repaired once from real-content measurements", async () => {
  const broken = {
    ...themed,
    css: `${themed.css}.hero-title{width:60px;font-size:64px}`,
  };
  const replies = [broken, themed];
  const previous = {
    fetch: globalThis.fetch,
    key: process.env.OPENROUTER_API_KEY,
    models: process.env.OPENROUTER_MODELS,
  };
  process.env.OPENROUTER_API_KEY = "sk-or-v1-test";
  process.env.OPENROUTER_MODELS = model.id;
  const requests: { messages: { role: string; content: string }[] }[] = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/models"))
      return Response.json({ data: [model] });
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({
      model: model.id,
      choices: [
        {
          finish_reason: "stop",
          message: { content: JSON.stringify(replies.shift()) },
        },
      ],
    });
  };
  try {
    const result = await createDesign(
      blueprint,
      facts,
      1,
      [],
      undefined,
      model.id,
      brief,
    );
    assert.equal(requests.length, 2);
    const repair = requests[1].messages.at(-1)!.content;
    assert.match(repair, /hero title \(\.hero-title\) is squeezed/);
    assert.match(repair, /keeping the same context reading, theme/);
    assert.ok(!result.design.css.includes("width:60px"));
    // Still broken after the repair round: rejected instead of shipping a broken layout.
    replies.push(broken, broken);
    await assert.rejects(
      createDesign(blueprint, facts, 1, [], undefined, model.id, brief),
      /still has layout problems/,
    );
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.key === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previous.key;
    if (previous.models === undefined) delete process.env.OPENROUTER_MODELS;
    else process.env.OPENROUTER_MODELS = previous.models;
  }
});
