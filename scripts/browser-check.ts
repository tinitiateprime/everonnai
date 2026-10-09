import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { website } from "../tests/fixtures";
import { extractPage } from "../lib/extract";
import type { Discovery } from "../lib/types";
import { saveGeneratedSite } from "../lib/site-store";

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
  const browser = await chromium.launch({ headless: true });
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
        html: website(),
        model: "test/coder:free",
        createdAt: new Date().toISOString(),
        warnings: [],
      };
      const saved = testDirectory
        ? await saveGeneratedSite(body.knowledge, artifact)
        : { ...artifact, path: `/service/northline-heating/${body.index + 1}` };
      await route.fulfill({ json: { artifact: saved } });
    });
    await page.goto(base);
    await page.getByText("Saved on this device", { exact: true }).waitFor();
    const required = await page.locator("[required]").count();
    assert.equal(required, 1);
    await page
      .locator("textarea[required]")
      .fill(
        "A community heating and cooling company with thoughtful service for homeowners.",
      );
    await page
      .getByRole("textbox", { name: "Business name" })
      .fill("Northline Heating");
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
    await page
      .getByText("All three designs are ready.", { exact: true })
      .waitFor();
    assert.deepEqual(generationCalls, [0, 1, 2]);
    assert.equal(planCalls, 1);
    await page.getByRole("button", { name: /Mechanical precision/ }).click();
    assert.equal(
      await page.locator("iframe").getAttribute("title"),
      "Mechanical precision website preview",
    );
    assert.equal(await page.locator("iframe").getAttribute("sandbox"), "");
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
        assert.ok(
          await directPage.evaluate(() => {
            try {
              localStorage.getItem("studio-data");
              return false;
            } catch {
              return true;
            }
          }),
        );
      }
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
    assert.ok((await page.locator("iframe").boundingBox())!.width <= 390);
    const downloadPromise = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download HTML", exact: true })
      .click();
    const downloaded = await downloadPromise;
    assert.equal(downloaded.suggestedFilename(), "mechanical-precision.html");
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
    await page
      .getByText("All three designs are ready.", { exact: true })
      .waitFor();
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
    await page.locator("iframe").waitFor();
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
      "Browser checks passed: business/1-3 website URLs, direct refresh and independent browser access, isolated generated documents, environment-only credentials, optional form, discovery, three variants, partial failure/retry, preview switching, downloads, device save, mobile layout and API errors. AI responses were mocked.",
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
    server?.kill();
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
