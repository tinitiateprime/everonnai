import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { load } from "cheerio";
import { brief, website } from "./fixtures";
import { saveGeneratedSite, readGeneratedSiteRecord } from "../lib/site-store";
import { knowledgePacket } from "../lib/prompts";
import { extractPage } from "../lib/extract";
import {
  assistantReply,
  createAssistantSession,
  loadAssistant,
  sessionVariables,
  unavailableActionResult,
} from "../lib/assistant";
import { attachAssistant } from "../lib/assistant-embed";
import { POST as sessionPost } from "../app/api/site-assistant/session/route";
import { POST as messagePost } from "../app/api/site-assistant/message/route";
import type { Discovery } from "../lib/types";
import { protectRequest } from "../lib/api";
import { assistantConnectionError } from "../lib/assistant-errors";

test("saved website evidence powers scoped ElevenLabs sessions and Gemini chat without leaking keys", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "everonn-assistant-test-"),
  );
  const keys = [
    "GENERATED_SITES_DIR",
    "ELEVENLABS_API_KEY",
    "ELEVENLABS_AGENT_ID",
    "GEMINI_API_KEY",
    "GEMINI_ASSISTANT_MODELS",
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  process.env.GENERATED_SITES_DIR = directory;
  process.env.ELEVENLABS_API_KEY = "test-eleven-secret";
  process.env.ELEVENLABS_AGENT_ID = "test-agent";
  process.env.GEMINI_API_KEY = "test-gemini-secret";
  process.env.GEMINI_ASSISTANT_MODELS = "test-model";
  const source: Discovery = {
    inputUrl: "https://northline.example",
    origin: "https://northline.example",
    pages: [
      extractPage(
        '<html><head><title>Services</title></head><body><h1>AC maintenance</h1><p>Saturday hours: 10am to 4pm.</p><a href="mailto:source@northline.example">Email</a></body></html>',
        "https://northline.example/",
      ),
    ],
    warnings: [],
    skipped: [],
    complete: true,
    discovered: 1,
    crawledAt: new Date().toISOString(),
  };
  try {
    const artifact = await saveGeneratedSite(
      brief,
      {
        id: "test-revision",
        index: 0,
        name: "First design",
        rationale: "Original design.",
        html: website(),
        model: "test-model",
        warnings: [],
        createdAt: new Date().toISOString(),
      },
      source,
    );
    const identity = {
      business: "northline",
      version: "1" as const,
      revision: artifact.id,
    };
    const record = await readGeneratedSiteRecord("northline", "1");
    assert.equal(record?.knowledgeJson, knowledgePacket(brief, source));
    const context = await loadAssistant(identity);
    const variables = sessionVariables(context);
    assert.ok(variables.faq_notes.includes("Saturday hours: 10am to 4pm"));
    assert.ok(variables.faq_notes.includes(brief.description));
    assert.ok(
      variables.faq_notes.includes("Owner-provided facts take precedence"),
    );
    assert.equal(variables.calendar_connected, "false");
    await assert.rejects(
      loadAssistant({ ...identity, revision: "different-revision" }),
      /updated/,
    );
    await assert.rejects(
      loadAssistant({ ...identity, business: "other-business" }),
      /unavailable/,
    );
    const calls: { url: string; body?: string; headers?: HeadersInit }[] = [];
    globalThis.fetch = async (url, options) => {
      calls.push({
        url: String(url),
        body: String(options?.body ?? ""),
        headers: options?.headers,
      });
      return String(url).includes("get-signed-url")
        ? Response.json({ signed_url: "wss://api.elevenlabs.io/test-signed" })
        : String(url).includes("conversation/token")
          ? Response.json({ token: "test-voice-token" })
          : Response.json({
              candidates: [
                {
                  content: {
                    parts: [
                      { text: "Saturday service hours are 10am to 4pm." },
                    ],
                  },
                },
              ],
            });
    };
    const voice = await createAssistantSession(context, "voice");
    assert.equal(voice.conversationToken, "test-voice-token");
    assert.equal(voice.signedUrl, undefined);
    assert.equal(calls.length, 1);
    const chat = await createAssistantSession(context, "chat");
    assert.ok(chat.signedUrl?.startsWith("wss:"));
    assert.equal(chat.conversationToken, undefined);
    assert.ok(!JSON.stringify(chat).includes("test-eleven-secret"));
    const answer = await assistantReply(context, [
      { role: "visitor", text: "What are Saturday hours?" },
    ]);
    assert.equal(answer.reply, "Saturday service hours are 10am to 4pm.");
    assert.ok(calls[2].body?.includes("Saturday hours: 10am to 4pm"));
    assert.ok(calls[2].body?.includes(brief.phone));
    const request = (
      route: string,
      body: unknown,
      origin = "https://studio.example",
    ) =>
      new Request(`https://studio.example${route}`, {
        method: "POST",
        headers: { origin, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const response = await sessionPost(
      request("/api/site-assistant/session", { ...identity, mode: "chat" }),
    );
    assert.equal(response.status, 200);
    assert.ok(
      !JSON.stringify(await response.json()).includes("test-eleven-secret"),
    );
    assert.equal(
      (
        await sessionPost(
          request(
            "/api/site-assistant/session",
            { ...identity, mode: "chat" },
            "https://attacker.example",
          ),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await messagePost(
          request("/api/site-assistant/message", {
            ...identity,
            revision: "other",
            messages: [{ role: "visitor", text: "Help" }],
          }),
        )
      ).status,
      400,
    );
    globalThis.fetch = async () =>
      new Response("provider unavailable", { status: 503 });
    const unavailable = await sessionPost(
      request("/api/site-assistant/session", { ...identity, mode: "chat" }),
    );
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json()).fallbackReady, true);
    globalThis.fetch = async () =>
      Response.json({
        candidates: [
          { content: { parts: [{ text: "I've booked your appointment." }] } },
        ],
      });
    const booking = await assistantReply(context, [
      { role: "visitor", text: "Book an appointment" },
    ]);
    assert.ok(booking.reply.includes("cannot confirm appointments"));
    const tools = JSON.parse(unavailableActionResult());
    assert.equal(tools.saved, false);
    assert.equal(tools.booked, false);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    assert.equal(
      path.dirname(path.resolve(directory)),
      path.resolve(os.tmpdir()),
    );
    assert.ok(path.basename(directory).startsWith("everonn-assistant-test-"));
    await rm(directory, { recursive: true, force: true });
  }
});
test("trusted widget uses an exact script hash while preserving AI CSS and rejecting forged resize messages", () => {
  const html = website();
  const page = attachAssistant(html, "northline", "1", "test-revision");
  const $ = load(page.html);
  const bootstrap = $("script").last().text();
  assert.equal($("style").text(), load(html)("style").text());
  assert.ok(
    page.csp.includes(
      `script-src 'sha256-${createHash("sha256").update(bootstrap).digest("base64")}'`,
    ),
  );
  assert.ok(page.csp.includes("frame-src 'self'"));
  assert.ok(bootstrap.includes("event.origin!==location.origin"));
  assert.ok(bootstrap.includes("event.source!==frame.contentWindow"));
  assert.ok(bootstrap.includes("microphone; autoplay"));
  assert.equal($("meta[http-equiv='Content-Security-Policy']").length, 0);
});
test("origin checks follow the incoming host rather than Next's internal localhost URL", () => {
  protectRequest(
    new Request("http://localhost:3056/api/site-assistant/session", {
      headers: { origin: "http://127.0.0.1:3056", host: "127.0.0.1:3056" },
    }),
    "origin-localhost",
  );
  protectRequest(
    new Request("http://localhost:3000/api/site-assistant/session", {
      headers: {
        origin: "https://studio.example",
        host: "studio.example",
        "x-forwarded-proto": "https",
      },
    }),
    "origin-proxy",
  );
  assert.throws(
    () =>
      protectRequest(
        new Request("http://localhost:3000/api/site-assistant/session", {
          headers: {
            origin: "https://attacker.example",
            host: "studio.example",
            "x-forwarded-proto": "https",
          },
        }),
        "origin-cross-site",
      ),
    /studio/,
  );
});
test("microphone denial and device failures provide an actionable error", () => {
  assert.match(
    assistantConnectionError(
      new DOMException("native denied", "NotAllowedError"),
      "voice",
    ),
    /access was denied/,
  );
  assert.match(
    assistantConnectionError(
      new DOMException("native missing", "NotFoundError"),
      "voice",
    ),
    /No microphone/,
  );
  assert.match(
    assistantConnectionError(
      new DOMException("native unavailable", "NotReadableError"),
      "voice",
    ),
    /used by another app/,
  );
  assert.match(assistantConnectionError("Not supported", "voice"), /Use chat/);
});
