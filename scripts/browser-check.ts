import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { spawn, execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { website } from "../tests/fixtures";
import { extractPage } from "../lib/extract";
import type { Discovery, Artifact } from "../lib/types";
import { saveGeneratedSite, readGeneratedSiteRecord } from "../lib/site-store";

const base = process.env.STUDIO_TEST_URL ?? "http://localhost:3047";
const testDirectory = process.env.STUDIO_TEST_URL
  ? null
  : mkdtempSync(path.join(os.tmpdir(), "everonn-site-browser-"));
if (testDirectory) process.env.GENERATED_SITES_DIR = testDirectory;
const server = process.env.STUDIO_TEST_URL
  ? null
  : spawn(
      process.execPath,
      ["node_modules/next/dist/bin/next", "start", "-p", "3047"],
      { windowsHide: true, stdio: "pipe", env: process.env },
    );
let logs = "";
server?.stdout.on("data", (data) => (logs += data));
server?.stderr.on("data", (data) => (logs += data));
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function main() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {
      /* starting */
    }
    if (i === 59) throw new Error(`Server did not start: ${logs}`);
    await pause(500);
  }
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-fake-device-for-media-stream"],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1080 },
      acceptDownloads: true,
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let discoverCalls = 0,
      planCalls = 0;
    const generationCalls: number[] = [];
    let failSecondVersion = false;
    let serverConfigured = false;
    const sourcePage = extractPage(website(), "https://northline.example/");
    const discovery: Discovery = {
      inputUrl: "https://northline.example",
      origin: "https://northline.example",
      pages: [sourcePage],
      warnings: [],
      skipped: [],
      discovered: 1,
      complete: true,
      crawledAt: new Date().toISOString(),
    };
    await page.route("**/api/models", (route) =>
      route.fulfill({
        json: {
          models: [
            {
              id: "test/coder:free",
              name: "Test coding model",
              context: 262144,
            },
          ],
          serverKeyConfigured: serverConfigured,
          accessTokenRequired: false,
        },
      }),
    );
    await page.route("**/api/discover", async (route) => {
      discoverCalls++;
      await route.fulfill({
        contentType: "application/x-ndjson",
        body:
          JSON.stringify({
            type: "progress",
            message: "Reading public pages…",
          }) +
          "\n" +
          JSON.stringify({ type: "result", discovery }) +
          "\n",
      });
    });
    const directions = [
      "Quiet warmth",
      "Mechanical precision",
      "Neighborhood comfort",
    ].map((name) => ({
      name,
      concept: "A thoughtful visual identity for this business.",
      palette: ["#203d25", "#f6f8ed", "#aac286"],
      typography: "A readable type pairing",
      composition:
        "A unique responsive composition emphasizing services and useful contacts.",
    }));
    await page.route("**/api/plan", async (route) => {
      planCalls++;
      assert.equal(route.request().headers()["x-openrouter-key"], undefined);
      assert.equal(route.request().postDataJSON().discovery.pages.length, 1);
      await route.fulfill({ json: { directions, model: "test/coder:free" } });
    });
    await page.route("**/api/generate", async (route) => {
      const body = route.request().postDataJSON();
      generationCalls.push(body.index);
      if (body.index === 1 && failSecondVersion) {
        failSecondVersion = false;
        await route.fulfill({
          status: 429,
          json: { error: "Test provider rate limit — retry this version." },
        });
        return;
      }
      const artifact = {
        id: `test-${body.index}-${Date.now()}`,
        index: body.index,
        name: body.direction.name,
        rationale: body.direction.concept,
        html:
          body.index === 1
            ? website().replace(
                "</body>",
                "<script>window.modelCodeRan=true</script></body>",
              )
            : website(),
        model: "test/coder:free",
        createdAt: new Date().toISOString(),
        warnings: [],
      };
      const saved = testDirectory
        ? await saveGeneratedSite(body.knowledge, artifact, body.discovery)
        : { ...artifact, path: `/service/northline-heating/${body.index + 1}` };
      await route.fulfill({ json: { artifact: saved } });
    });
    await page.goto(base);
    await page.getByText("Saved on this device", { exact: true }).waitFor();
    const required = await page.locator("[required]").count();
    assert.equal(required, 3);
    await page
      .locator("textarea[required]")
      .fill(
        "A community heating and cooling company with thoughtful service for homeowners.",
      );
    await page
      .getByRole("textbox", { name: "Business name" })
      .fill("Northline Heating");
    await page
      .getByRole("textbox", { name: "Business type" })
      .fill("Heating and cooling services");
    await page
      .getByRole("button", { name: "Add a service", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Service name" })
      .fill("AC installation");
    await page.getByRole("button", { name: "Remove service 1" }).click();
    assert.equal(
      await page.getByRole("textbox", { name: "Service name" }).count(),
      0,
    );
    await page
      .getByRole("textbox", { name: "Existing website link" })
      .fill("https://northline.example");
    await page.getByText("1 pages read", { exact: true }).waitFor();
    assert.equal(discoverCalls, 1);
    await page
      .getByRole("button", { name: "Generate three websites", exact: true })
      .click();
    await page
      .getByText(
        "Website generation is not connected yet. Ask the studio administrator to configure it.",
        { exact: true },
      )
      .waitFor();
    await page
      .getByRole("button", { name: "Generation settings", exact: true })
      .click();
    assert.equal(
      await page.getByRole("textbox", { name: "OpenRouter API key" }).count(),
      0,
    );
    await pause(600);
    serverConfigured = true;
    await page.reload();
    await page.getByText("Saved on this device", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Generate three websites", exact: true })
      .click();
    await page.getByText(/^All three designs are ready\./).waitFor();
    assert.deepEqual(generationCalls, [0, 1, 2]);
    assert.equal(planCalls, 1);
    await page.getByRole("button", { name: /Mechanical precision/ }).click();
    assert.equal(
      await page
        .locator("iframe[title$='website preview']")
        .getAttribute("title"),
      "Mechanical precision website preview",
    );
    assert.equal(
      await page
        .locator("iframe[title$='website preview']")
        .getAttribute("sandbox"),
      "",
    );
    assert.equal(
      await page
        .getByRole("link", { name: "Open website", exact: true })
        .getAttribute("href"),
      "/service/northline-heating/2",
    );
    if (testDirectory) {
      const directContext = await browser.newContext();
      const directPage = await directContext.newPage();
      for (const version of [1, 2, 3]) {
        const response = await directPage.goto(
          `${base}/service/northline-heating/${version}`,
        );
        assert.equal(response?.status(), 200);
        await directPage
          .getByRole("heading", {
            name: "Northline: comfort at home",
            exact: true,
          })
          .waitFor();
        const refreshed = await directPage.reload();
        assert.equal(refreshed?.status(), 200);
        await directPage
          .frameLocator("iframe[title='Business voice and chat assistant']")
          .getByRole("button", { name: "Chat with us", exact: true })
          .waitFor();
        const responseHeaders = response?.headers() ?? {};
        assert.ok(
          responseHeaders["content-security-policy"].includes(
            "script-src 'sha256-",
          ),
        );
        assert.equal(
          await directPage.evaluate(() => Reflect.get(window, "modelCodeRan")),
          undefined,
        );
      }
      const assistant = directPage.frameLocator(
        "iframe[title='Business voice and chat assistant']",
      );
      let voiceSessionRequests = 0;
      await directPage.route("**/api/site-assistant/session", (route) => {
        if (route.request().postDataJSON().mode === "voice")
          voiceSessionRequests++;
        return route.fulfill({
          status: 503,
          json: {
            error: "Live provider temporarily unavailable",
            fallbackReady: true,
            greeting: "Hi, how can I help with Northline Heating?",
          },
        });
      });
      await directPage.route("**/api/site-assistant/message", (route) => {
        const input = route.request().postDataJSON();
        assert.equal(input.business, "northline-heating");
        assert.equal(input.version, "3");
        assert.ok(input.revision);
        assert.equal(input.knowledge, undefined);
        assert.equal(input.messages.at(-1).role, "visitor");
        return route.fulfill({
          json: {
            reply: "We offer AC installation and heating maintenance.",
            model: "test-gemini",
          },
        });
      });
      await assistant
        .getByRole("button", { name: "Chat with us", exact: true })
        .click();
      await assistant.locator('.agent-panel[data-status="fallback"]').waitFor();
      await assistant
        .getByRole("textbox", { name: "Your message", exact: true })
        .fill("What services do you offer?");
      await assistant
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      try {
        await assistant
          .getByText("We offer AC installation and heating maintenance.", {
            exact: true,
          })
          .waitFor({ timeout: 7000 });
      } catch {
        throw new Error(
          "Assistant UI check failed: " +
            (await assistant.locator(".agent-panel").innerText()),
        );
      }
      await directContext.grantPermissions([], { origin: base });
      await assistant
        .getByRole("button", { name: "Talk to us", exact: true })
        .click();
      try {
        await assistant.locator(".agent-error").waitFor({ timeout: 7000 });
      } catch {
        throw new Error(
          "Microphone denial UI: " +
            (await assistant.locator(".agent-panel").innerText()),
        );
      }
      assert.match(
        await assistant.locator(".agent-error").innerText(),
        /Microphone access was denied|Voice is unavailable/,
      );
      assert.equal(voiceSessionRequests, 0);
      await assistant
        .getByRole("button", { name: "Close assistant", exact: true })
        .click();
      await directPage.waitForFunction(
        () =>
          parseFloat(
            document.querySelector<HTMLIFrameElement>(
              "iframe[title='Business voice and chat assistant']",
            )!.style.height,
          ) <= 76,
      );
      await directPage.evaluate(() =>
        window.postMessage(
          { type: "everonn-assistant-size", open: true },
          window.location.origin,
        ),
      );
      assert.ok(
        (await directPage
          .locator("iframe[title='Business voice and chat assistant']")
          .boundingBox())!.height <= 76,
      );
      await directPage.setViewportSize({ width: 390, height: 844 });
      await assistant
        .getByRole("button", { name: "Chat with us", exact: true })
        .click();
      await assistant.locator('.agent-panel[data-status="fallback"]').waitFor();
      assert.ok(
        (await directPage
          .locator("iframe[title='Business voice and chat assistant']")
          .boundingBox())!.width <= 366,
      );
      await assistant
        .getByRole("button", { name: "Close assistant", exact: true })
        .click();
      assert.equal(
        (
          await directPage.goto(`${base}/service/northline-heating/4`)
        )?.status(),
        404,
      );
      assert.equal(
        (await directPage.goto(`${base}/service/missing-business/1`))?.status(),
        404,
      );
      await directContext.close();
    }
    await page
      .getByRole("button", { name: "Mobile preview", exact: true })
      .click();
    assert.ok(
      (await page.locator("iframe[title$='website preview']").boundingBox())!
        .width <= 390,
    );
    const downloadPromise = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download HTML", exact: true })
      .click();
    const downloaded = await downloadPromise;
    assert.equal(downloaded.suggestedFilename(), "mechanical-precision.html");
    const editCalls: unknown[] = [];
    let rejectEdit = true;
    let conflictArtifact: Artifact | null = null;
    await page.route("**/api/refine", async (route) => {
      const body = route.request().postDataJSON();
      editCalls.push(body);
      assert.equal(body.business, "northline-heating");
      assert.equal(body.version, "2");
      assert.equal(body.knowledge, undefined);
      assert.equal(body.html, undefined);
      assert.equal(route.request().headers()["x-openrouter-key"], undefined);
      if (rejectEdit) {
        rejectEdit = false;
        await route.fulfill({
          status: 400,
          json: {
            error: "Edit provider unavailable. Your saved site is preserved.",
          },
        });
        return;
      }
      const record = testDirectory
        ? await readGeneratedSiteRecord(body.business, body.version)
        : null;
      if (conflictArtifact) {
        const latest = record?.generationContext
          ? await saveGeneratedSite(
              record.generationContext.knowledge,
              conflictArtifact,
              record.generationContext.discovery,
            )
          : conflictArtifact;
        conflictArtifact = null;
        await route.fulfill({
          status: 409,
          json: {
            error:
              "This version changed. The latest saved design is now loaded; review it and apply your prompt again.",
            latestArtifact: latest,
          },
        });
        return;
      }
      const updated = {
        ...(record?.artifact ?? {
          index: 1,
          name: directions[1].name,
          model: "test/coder:free",
          rationale: directions[1].concept,
          warnings: [],
          createdAt: new Date().toISOString(),
        }),
        id: "browser-edited-version-2",
        html: website().replace("comfort at home", "A warmer welcome"),
        edits: [{ prompt: body.prompt, createdAt: new Date().toISOString() }],
      };
      const saved = record?.generationContext
        ? await saveGeneratedSite(
            record.generationContext.knowledge,
            updated,
            record.generationContext.discovery,
            body.revision,
          )
        : { ...updated, path: "/service/northline-heating/2" };
      await route.fulfill({ json: { artifact: saved } });
    });
    const beforeEdit = await page
      .locator("iframe[title$='website preview']")
      .getAttribute("srcdoc");
    await page
      .getByRole("textbox", { name: "Describe your changes" })
      .fill("Make the welcome warmer and more inviting.");
    await pause(650);
    await page.reload();
    await page.getByText("Saved on this device", { exact: true }).waitFor();
    await page.getByRole("tab", { name: /Your designs/ }).click();
    await page.getByRole("button", { name: /Mechanical precision/ }).click();
    assert.equal(
      await page
        .getByRole("textbox", { name: "Describe your changes" })
        .inputValue(),
      "Make the welcome warmer and more inviting.",
    );
    await page
      .getByRole("button", { name: "Apply changes", exact: true })
      .click();
    await page
      .getByText("Edit provider unavailable. Your saved site is preserved.", {
        exact: true,
      })
      .waitFor();
    assert.equal(
      await page
        .locator("iframe[title$='website preview']")
        .getAttribute("srcdoc"),
      beforeEdit,
    );
    await page
      .getByRole("button", { name: "Apply changes", exact: true })
      .click();
    await page
      .getByText(
        "Changes applied to version 2. Your website link is updated.",
        { exact: true },
      )
      .waitFor();
    assert.equal(editCalls.length, 2);
    assert.ok(
      (
        await page
          .locator("iframe[title$='website preview']")
          .getAttribute("srcdoc")
      )?.includes("A warmer welcome"),
    );
    assert.equal(
      await page
        .getByRole("textbox", { name: "Describe your changes" })
        .inputValue(),
      "",
    );
    assert.equal(
      await page
        .getByRole("link", { name: "Open website", exact: true })
        .getAttribute("href"),
      "/service/northline-heating/2",
    );
    if (testDirectory) {
      assert.equal(
        (await readGeneratedSiteRecord("northline-heating", "2"))?.artifact.id,
        "browser-edited-version-2",
      );
      assert.notEqual(
        (await readGeneratedSiteRecord("northline-heating", "1"))?.artifact.id,
        "browser-edited-version-2",
      );
      assert.notEqual(
        (await readGeneratedSiteRecord("northline-heating", "3"))?.artifact.id,
        "browser-edited-version-2",
      );
    }
    await pause(600);
    await page.reload();
    await page.getByText("Saved on this device", { exact: true }).waitFor();
    await page.getByRole("tab", { name: /Your designs/ }).click();
    await page.getByRole("button", { name: /Mechanical precision/ }).click();
    await page.getByText("Accepted changes (1)", { exact: true }).waitFor();
    assert.ok(
      (
        await page
          .locator("iframe[title$='website preview']")
          .getAttribute("srcdoc")
      )?.includes("A warmer welcome"),
    );
    const storedForConflict = testDirectory
      ? await readGeneratedSiteRecord("northline-heating", "2")
      : null;
    conflictArtifact = {
      ...(storedForConflict?.artifact ?? {
        index: 1,
        name: directions[1].name,
        model: "test/coder:free",
        rationale: directions[1].concept,
        warnings: [],
        createdAt: new Date().toISOString(),
      }),
      id: "newer-version-from-another-browser",
      path: "/service/northline-heating/2",
      html: website().replace("comfort at home", "The latest saved welcome"),
    };
    await page
      .getByRole("textbox", { name: "Describe your changes" })
      .fill("Make the heading clearer.");
    await page
      .getByRole("button", { name: "Apply changes", exact: true })
      .click();
    await page
      .getByText(
        "This version changed. The latest saved design is now loaded; review it and apply your prompt again.",
        { exact: true },
      )
      .waitFor();
    assert.ok(
      (
        await page
          .locator("iframe[title$='website preview']")
          .getAttribute("srcdoc")
      )?.includes("The latest saved welcome"),
    );
    assert.equal(
      await page
        .getByRole("textbox", { name: "Describe your changes" })
        .inputValue(),
      "Make the heading clearer.",
    );
    assert.equal(
      await page
        .getByRole("link", { name: "Open website", exact: true })
        .getAttribute("href"),
      "/service/northline-heating/2",
    );
    // A new set makes a new plan; completed siblings survive a failed version.
    failSecondVersion = true;
    await page
      .getByRole("button", { name: "Create three new designs", exact: true })
      .click();
    await page
      .getByText("2 of 3 designs ready. Retry any unfinished version.", {
        exact: true,
      })
      .waitFor();
    assert.equal(planCalls, 2);
    await page
      .getByRole("button", { name: "Retry this version", exact: true })
      .click();
    await page.getByText(/^All three designs are ready\./).waitFor();
    assert.equal(planCalls, 2);
    assert.deepEqual(generationCalls, [0, 1, 2, 0, 1, 2, 1]);
    await pause(600);
    const saved = await page.evaluate(
      () =>
        new Promise<string>((resolve, reject) => {
          const request = indexedDB.open("everonn-website-studio", 1);
          request.onsuccess = () => {
            const db = request.result;
            const read = db
              .transaction("drafts")
              .objectStore("drafts")
              .get("current");
            read.onsuccess = () => {
              resolve(JSON.stringify(read.result));
              db.close();
            };
            read.onerror = () => reject(read.error);
          };
        }),
    );
    assert.ok(
      !saved.includes("apiKey") && !saved.includes("OPENROUTER_API_KEY"),
    );
    assert.equal(JSON.parse(saved).artifacts.length, 3);
    await page.reload();
    await page.getByText("Saved on this device", { exact: true }).waitFor();
    assert.equal(
      await page.locator("textarea[required]").inputValue(),
      "A community heating and cooling company with thoughtful service for homeowners.",
    );
    await page.getByRole("tab", { name: /Your designs/ }).click();
    await page.locator("iframe[title$='website preview']").waitFor();
    await mkdir("artifacts", { recursive: true });
    await page.screenshot({
      path: "artifacts/designs-desktop.png",
      fullPage: true,
    });
    await page.getByRole("tab", { name: /Business knowledge/ }).click();
    await page.screenshot({
      path: "artifacts/knowledge-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await page.screenshot({
      path: "artifacts/knowledge-mobile.png",
      fullPage: true,
    });
    // Checkpoint pages merge across batches and survive refresh before extending the same crawl.
    await page.setViewportSize({ width: 1440, height: 1080 });
    const crawlId = randomUUID(),
      snapshotId = randomUUID();
    const largePages = Array.from({ length: 50 }, (_, i) => ({
      ...sourcePage,
      url: `https://northline.example/page-${i}`,
      title: `Business page ${i}`,
    }));
    let crawlBatches = 0;
    await page.unroute("**/api/discover");
    await page.route("**/api/discover", async (route) => {
      const body = route.request().postDataJSON();
      crawlBatches++;
      if (crawlBatches > 1) assert.equal(body.crawlId, crawlId);
      if (crawlBatches === 2) assert.equal(body.capturedCount, 1);
      if (crawlBatches === 3) {
        assert.equal(body.extend, true);
        assert.equal(body.capturedCount, 40);
      }
      const count = crawlBatches === 1 ? 1 : crawlBatches === 2 ? 40 : 50;
      const metadata = {
        ...discovery,
        pages: [],
        complete: count === 50,
        discovered: 50,
        crawl: {
          id: crawlId,
          revision: randomUUID(),
          pageLimit: count === 50 ? 80 : 40,
          remaining: 50 - count,
          canContinue: count === 1,
          canExtend: count < 50,
          status: count === 50 ? "complete" : count === 40 ? "limit" : "paused",
        },
      };
      const pages =
        crawlBatches === 1
          ? largePages.slice(0, 1)
          : crawlBatches === 2
            ? largePages.slice(1, 40)
            : largePages.slice(40);
      await route.fulfill({
        contentType: "application/x-ndjson",
        body: `${JSON.stringify({ type: "checkpoint", discovery: metadata, pages })}\n${JSON.stringify({ type: "result", discovery: metadata, pages: [] })}\n`,
      });
    });
    await page.getByRole("button", { name: "Read again", exact: true }).click();
    await page.getByText("40 pages read", { exact: true }).waitFor();
    assert.equal(crawlBatches, 2);
    await page
      .getByRole("button", { name: "Read more pages", exact: true })
      .waitFor();
    await pause(650);
    await page.reload();
    await page.getByText("Saved on this device", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Read more pages", exact: true })
      .click();
    await page.getByText("50 pages read", { exact: true }).waitFor();
    assert.equal(crawlBatches, 3);
    await page.unroute("**/api/plan");
    await page.route("**/api/plan", async (route) => {
      const body = route.request().postDataJSON();
      assert.equal(body.discoveryId, crawlId);
      assert.equal(body.discovery, undefined);
      await route.fulfill({
        json: {
          directions,
          model: "test/coder:free",
          sourceSnapshotId: snapshotId,
        },
      });
    });
    await page.unroute("**/api/generate");
    let frozenGenerations = 0;
    await page.route("**/api/generate", async (route) => {
      const body = route.request().postDataJSON();
      assert.equal(body.sourceSnapshotId, snapshotId);
      assert.equal(body.discovery, undefined);
      frozenGenerations++;
      const artifact = {
        id: randomUUID(),
        index: body.index,
        name: body.direction.name,
        rationale: body.direction.concept,
        html: website(),
        model: "test/coder:free",
        createdAt: new Date().toISOString(),
        warnings: [],
      };
      const saved = testDirectory
        ? await saveGeneratedSite(body.knowledge, artifact, {
            ...discovery,
            pages: largePages,
          })
        : { ...artifact, path: `/service/northline-heating/${body.index + 1}` };
      await route.fulfill({ json: { artifact: saved } });
    });
    await page
      .getByRole("button", { name: "Generate three websites", exact: true })
      .click();
    await page.getByText(/^All three designs are ready\./).waitFor();
    assert.equal(frozenGenerations, 3);
    // Actual routes: reject local crawling and reject a generation request without credentials.
    await page.unroute("**/api/discover");
    await page.unroute("**/api/plan");
    const routeChecks = await page.evaluate(async () => {
      const discover = await fetch("/api/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "http://127.0.0.1" }),
      });
      const plan = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ knowledge: { description: "Bakery" } }),
      });
      return {
        discover: await discover.text(),
        plan: await plan.json(),
        status: plan.status,
      };
    });
    assert.ok(routeChecks.discover.includes("Private and local"));
    assert.ok(routeChecks.plan.error);
    assert.equal(routeChecks.status, 400);
    assert.deepEqual(errors, []);
    console.log(
      "Browser checks passed: required business fields, selected-version prompt edits, failed edits, conflict recovery, prompt/history persistence, stable business/1-3 URLs, isolated documents, credential exclusion, discovery, three variants, retry, previews, downloads, mobile layout and API errors. AI responses were mocked.",
    );
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
    if (server?.pid && server.exitCode === null) {
      if (process.platform === "win32")
        await new Promise<void>((resolve) =>
          execFile(
            "taskkill",
            ["/pid", String(server.pid), "/T", "/F"],
            { windowsHide: true },
            () => resolve(),
          ),
        );
      else {
        server.kill("SIGTERM");
        await new Promise<void>((resolve) =>
          server.once("exit", () => resolve()),
        );
      }
    }
    if (testDirectory) {
      assert.equal(
        path.dirname(path.resolve(testDirectory)),
        path.resolve(os.tmpdir()),
      );
      assert.ok(
        path.basename(testDirectory).startsWith("everonn-site-browser-"),
      );
      await rm(testDirectory, { recursive: true, force: true });
    }
  });
