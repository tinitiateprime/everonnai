import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { emptyKnowledge } from "../lib/types";
import { saveGeneratedSite } from "../lib/site-store";

// Explicit live integration probe: uses fictional facts and the configured providers.
const directory = mkdtempSync(
  path.join(os.tmpdir(), "everonn-assistant-live-"),
);
process.env.GENERATED_SITES_DIR = directory;
const base = "http://127.0.0.1:3056";
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3056",
  ],
  { windowsHide: true, stdio: "pipe", env: process.env },
);
let logs = "";
server.stdout.on("data", (data) => (logs += data));
server.stderr.on("data", (data) => (logs += data));
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function main() {
  const knowledge = {
    ...emptyKnowledge,
    businessName: "Assistant verification studio",
    businessType: "Bicycle repair",
    description:
      "A fictional bicycle repair studio used to verify assistant grounding. It specializes in repairing bicycles and straightening bicycle wheels.",
    hours: "Saturday 11am–3pm",
    services: [
      { name: "Wheel truing", description: "Straightening bicycle wheels." },
    ],
  };
  const artifact = await saveGeneratedSite(knowledge, {
    id: randomUUID(),
    index: 0,
    name: "Live assistant verification",
    rationale: "Test-only integration fixture.",
    html: '<!doctype html><html><head><title>Assistant verification studio</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font-family:Arial;margin:0;padding:50px;color:#263b30;background:#f6f9ee}h1{font-size:44px}p{font-size:20px}</style></head><body><main><h1>Assistant verification studio</h1><p>Bicycle repair and wheel truing. Saturday 11am–3pm.</p></main></body></html>',
    model: "integration-fixture",
    warnings: [],
    createdAt: new Date().toISOString(),
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {
      /* starting */
    }
    if (i === 59) throw new Error("Test server did not start: " + logs);
    await pause(500);
  }
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  });
  try {
    const context = await browser.newContext({
      permissions: ["microphone"],
      viewport: { width: 1280, height: 1000 },
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base + artifact.path);
    const frame = page.frameLocator(
      "iframe[title='Business voice and chat assistant']",
    );
    await frame
      .getByRole("button", { name: "Chat with us", exact: true })
      .click();
    try {
      await frame
        .locator('.agent-panel[data-status="live"]')
        .waitFor({ timeout: 45000 });
    } catch {
      const status = await frame
        .locator(".agent-panel")
        .getAttribute("data-status");
      const error = await frame.locator(".agent-error").allTextContents();
      throw new Error(
        `Live chat did not connect (state ${status}): ${error.join(" ").replace(/https?:\/\/\S+|wss?:\/\/\S+/g, "[provider URL]")}`,
      );
    }
    await frame
      .getByRole("textbox", { name: "Your message", exact: true })
      .fill("What are your Saturday hours and what is wheel truing?");
    await frame
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await frame
      .locator(".agent-message.assistant")
      .filter({ hasText: /11.*3|11.*15/ })
      .last()
      .waitFor({ timeout: 60000 });
    const text = await frame
      .locator(".agent-message.assistant")
      .allTextContents();
    assert.ok(text.join(" ").toLowerCase().includes("wheel"));
    console.log(
      "Verified live ElevenLabs text chat: supplied bicycle services and Saturday hours were used.",
    );
    await frame
      .getByRole("button", { name: "Close assistant", exact: true })
      .click();
    await frame
      .getByRole("button", { name: "Talk to us", exact: true })
      .click();
    await frame
      .getByRole("button", { name: "End conversation", exact: true })
      .waitFor({ timeout: 45000 });
    await frame.getByRole("button", { name: "Mute", exact: true }).click();
    await frame.getByRole("button", { name: "Unmute", exact: true }).waitFor();
    await frame
      .getByRole("button", { name: "End conversation", exact: true })
      .click();
    console.log(
      "Verified live ElevenLabs WebRTC voice connection with a synthetic microphone; mute and end controls worked.",
    );
    const fallback = await context.request.post(
      `${base}/api/site-assistant/message`,
      {
        headers: { origin: base },
        data: {
          business: "assistant-verification-studio",
          version: "1",
          revision: artifact.id,
          messages: [
            { role: "visitor", text: "What are your Saturday hours?" },
          ],
        },
      },
    );
    const result = await fallback.json();
    assert.equal(fallback.status(), 200, result.error);
    assert.match(result.reply, /11.*3|11.*15/);
    console.log(
      "Verified live Gemini text response against the same saved knowledge snapshot.",
    );
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
  }
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    server.kill();
    assert.equal(
      path.dirname(path.resolve(directory)),
      path.resolve(os.tmpdir()),
    );
    assert.ok(path.basename(directory).startsWith("everonn-assistant-live-"));
    await rm(directory, { recursive: true, force: true });
  });
