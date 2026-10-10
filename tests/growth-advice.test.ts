import test from "node:test";
import assert from "node:assert/strict";
import { adviseReport } from "../lib/intelligence/adviser";
import type {
  AdviceCorrection,
  IntelligenceReport,
  IntelligenceRun,
} from "../lib/intelligence/contracts";
import { model } from "./fixtures";

const report = {
  coverage: { assessed: 1, browserAssessed: 1, assessmentGaps: [] },
  limitations: [],
  pages: [
    {
      captureId: "c1",
      url: "https://cafe.example/",
      title: "Cafe",
      family: "home",
      featureKinds: ["navigation"],
      counts: {},
      browserStatus: "observed",
      findingIds: ["f1"],
      limits: [],
    },
  ],
  findings: [
    {
      id: "f1",
      rule: "missing-phone-link",
      title: "No tappable phone number",
      area: "conversion",
      priority: "P1",
      detail: "The phone number is plain text.",
      evidenceIds: ["ref-1"],
    },
  ],
  features: [],
  designSystem: { components: [], tokens: [] },
  references: [
    {
      id: "ref-1",
      captureId: "c1",
      url: "https://cafe.example/",
      observation: "Phone shown as text without a tel: link",
    },
    {
      id: "ref-unsent",
      captureId: "c1",
      url: "https://cafe.example/",
      observation: "Not linked from any finding",
    },
  ],
} as unknown as IntelligenceReport;
const config = {
  version: "site-intelligence-v1",
  mode: "live",
  provider: "openrouter",
  model: model.id,
  viewports: [1440, 768, 390],
  batchPages: 2,
  maxRequests: 180,
  maxNetworkBytes: 24_000_000,
  pageSeconds: 65,
  fullFeatureBackendTests: false,
} as IntelligenceRun["config"];
const corrections: AdviceCorrection[] = [
  {
    id: "corr-active",
    runId: null,
    body: "We do not offer delivery.",
    createdAt: "2026-10-10T00:00:00Z",
    withdrawnAt: null,
  },
  {
    id: "corr-withdrawn",
    runId: null,
    body: "Events are our main business.",
    createdAt: "2026-10-10T00:00:00Z",
    withdrawnAt: "2026-10-10T01:00:00Z",
  },
];
const growth = {
  customerGaps:
    "- Visitors on phones cannot tap to call: the number on the home page is plain text.",
  enhancementPlan:
    "- Our agent will rebuild the home page with a prominent tap-to-call button and clear opening information.",
  agentPrompt:
    "Rebuild the cafe website as a mobile-first multi-page site. Keep every captured page. Add a tap-to-call link. Do not mention delivery.",
  evidenceIds: ["ref-1"],
  appliedCorrectionIds: ["corr-active", "corr-invented"],
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
      usage: { prompt_tokens: 900, completion_tokens: 400 },
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

test("growth advisor uses the skill and active owner corrections and returns plain-language advice", async () => {
  await withProvider(
    {
      summary: "Customers can find the cafe but cannot easily act on mobile.",
      recommendations: [
        {
          title: "Make the phone number tappable",
          why: "Mobile visitors cannot call directly from the page.",
          priority: "P1",
          evidenceIds: ["ref-1"],
          acceptance: ["The phone number is a tel: link on every page."],
        },
      ],
      growth,
    },
    async (sent) => {
      const advice = await adviseReport(report, config, undefined, corrections);
      assert.equal(advice.status, "available", advice.limitations.join(" "));
      assert.equal(advice.growth?.customerGaps, growth.customerGaps);
      assert.equal(advice.growth?.enhancementPlan, growth.enhancementPlan);
      assert.equal(advice.growth?.agentPrompt, growth.agentPrompt);
      // Only corrections that were actually supplied can be reported as applied.
      assert.deepEqual(advice.growth?.appliedCorrectionIds, ["corr-active"]);
      const messages = sent.body!.messages as {
        role: string;
        content: string;
      }[];
      assert.match(messages[0].content, /Site growth advisor SKILL\.md/);
      assert.match(messages[0].content, /lacking to attract customers/);
      const user = JSON.parse(messages[1].content);
      assert.deepEqual(user.ownerCorrections, [
        { id: "corr-active", correction: "We do not offer delivery." },
      ]);
      assert.ok(
        user.evidenceReport.references.some(
          (r: { id: string }) => r.id === "ref-1",
        ),
      );
      assert.equal(sent.body!.max_tokens, 12000);
    },
  );
});

test("growth advice citing unsupplied evidence or missing the growth section is rejected", async () => {
  const recommendations = [
    {
      title: "Make the phone number tappable",
      why: "Mobile visitors cannot call directly from the page.",
      priority: "P1",
      evidenceIds: ["ref-1"],
      acceptance: ["The phone number is a tel: link on every page."],
    },
  ];
  await withProvider(
    {
      summary: "A summary for the owner.",
      recommendations,
      growth: { ...growth, evidenceIds: ["ref-unsent"] },
    },
    async () => {
      const advice = await adviseReport(report, config, undefined, corrections);
      assert.equal(advice.status, "inconclusive");
      assert.equal(advice.growth, undefined);
      assert.match(advice.limitations[0], /outside its supplied packet/);
    },
  );
  await withProvider(
    { summary: "A summary for the owner.", recommendations },
    async () => {
      const advice = await adviseReport(report, config, undefined, corrections);
      assert.equal(advice.status, "inconclusive");
      assert.equal(advice.recommendations.length, 0);
    },
  );
});
