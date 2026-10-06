import { loadEnvConfig } from "@next/env";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import type { BusinessProfile, WebsiteSpec } from "../features/everonn/types";

// Explicit paid-provider review using a fictional business and isolated metering.
// No account, customer workspace, shared database, published site, or email is changed.
async function main() {
  const flags = process.argv.slice(2);
  const live = flags.includes("--live");
  const reviewExisting = flags.includes("--review-existing");
  if (flags.some((flag) => !["--live", "--review-existing"].includes(flag)) || live === reviewExisting) {
    throw new Error("Choose --live for paid Gemini/Pexels generation or --review-existing to inspect the saved fictional artifact without generation calls.");
  }
  loadEnvConfig(process.cwd());
  const usageDir = live ? await mkdtemp(path.join(tmpdir(), "everonn-live-website-usage-")) : undefined;
  for (const name of ["SUPABASE_DB_URL", "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_USAGE_SCHEMA", "AWS_LAMBDA_FUNCTION_NAME", "NETLIFY_BLOBS_CONTEXT"]) process.env[name] = "";
  process.env.NETLIFY = "false";
  if (usageDir) process.env.EVERONN_USAGE_DIR = usageDir;
  process.env.USAGE_REQUIRE_DURABLE_STORAGE = "false";
  process.env.EVERONN_REQUIRE_DURABLE_STORAGE = "false";
  process.env.USAGE_BACKGROUND_MODE = "external";
  const { createDemoWorkspace } = await import("../features/everonn/demo-data");
  const { generateWebsiteSpec } = await import("../features/website-studio/ai-generator");
  const { generateWebsiteCode } = await import("../features/website-studio/code-generator");
  const { normalizeWebsiteCodeConcept, prepareWebsitePage } = await import("../features/website-studio/code-validation");
  const { runWebsiteQa, WEBSITE_CONCEPTS } = await import("../features/website-studio/generator");
  const { resolveWebsiteMedia } = await import("../features/website-studio/media");
  const { EMPTY_WEBSITE_PREFERENCES, saveWebsiteMemory } = await import("../features/agent-runtime/memory");
  let profile = createDemoWorkspace().profile;
  profile.workspaceId = "isolated_hvac_live_review";
  const memory = saveWebsiteMemory({ profile, actor: { workspaceId: profile.workspaceId, role: "owner", userId: "isolated-review" }, preferences: { ...EMPTY_WEBSITE_PREFERENCES, brief: "A premium, distinctive heating and cooling website. Clear practical service choices, sophisticated typography and calm composition. Make each concept feel like an independently designed website. Use equipment and home interior photography, with no invented claims.", imagery: "equipment" } });
  const usage = { workspaceId: profile.workspaceId, feature: "website_generation" as const };
  const output = path.join(process.cwd(), "artifacts", "hvac-live");
  await mkdir(output, { recursive: true });
  let result: { profile: BusinessProfile; spec: WebsiteSpec; model?: string };
  if (reviewExisting) {
    console.log("Reviewing the saved fictional website without new generation calls.");
    result = JSON.parse(await readFile(path.join(output, "website.json"), "utf8"));
    if (!result.spec?.code || result.profile?.workspaceId !== "isolated_hvac_live_review") {
      throw new Error("A complete fictional HVAC review artifact is required. Generate it with --live first.");
    }
    profile = result.profile;
    for (const concept of WEBSITE_CONCEPTS) {
      result.spec.code.concepts[concept] = normalizeWebsiteCodeConcept(result.spec.code.concepts[concept], result.spec, profile);
    }
  } else {
    console.log("Generating fictional HVAC content with Gemini; metering is isolated.");
    const content = await generateWebsiteSpec(profile, { memory, usage });
    const media = await resolveWebsiteMedia(content.spec, profile, { preferences: memory[0].value });
    content.spec.media = { hero: media.hero, story: media.story, gallery: media.gallery, services: media.services };
    console.log("Generating three original HTML/CSS concepts with " + content.model + ".");
    content.spec.code = await generateWebsiteCode(content.spec, profile, { model: content.model, memory, usage });
    result = { profile, spec: content.spec, model: content.model };
    await writeFile(path.join(output, "website.json"), JSON.stringify(result, null, 2));
  }
  if (!runWebsiteQa(result.spec, profile).passed) throw new Error("The review artifact did not pass business grounding checks.");
  const code = result.spec.code!;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.SMOKE_CHROME_PATH || (process.platform === "win32" ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" : undefined) });
  const review: Array<{ concept: string; route: string; width: number; overflow: boolean; brokenImages: number; heading: string | null }> = [];
  try {
    const page = await browser.newPage();
    for (const [name, concept] of Object.entries(code.concepts)) {
      for (const codePage of concept.pages) {
        const prepared = prepareWebsitePage(codePage, concept.css, result.spec, profile, name, "/sites/review", false);
        const html = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name}</title><style>html,body{margin:0}#everonn-generated-site{contain:layout paint style;isolation:isolate;min-height:100vh;--brand-primary:${result.spec.visualDirection.primaryColor};--brand-accent:${result.spec.visualDirection.accentColor}}</style><style>${prepared.css}</style></head><body><div id="everonn-generated-site">${prepared.html}</div></body></html>`;
        for (const width of [1440, 390]) {
          await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
          await page.setContent(html, { waitUntil: "networkidle", timeout: 30000 });
          // Full-page captures must load below-fold photographs as well.
          await page.locator("img").evaluateAll((images) => images.forEach((image) => { (image as HTMLImageElement).loading = "eager"; }));
          await page.waitForFunction(() => [...document.images].every((image) => image.complete), undefined, { timeout: 10000 }).catch(() => undefined);
          review.push({ concept: name, route: codePage.path, width, overflow: await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), brokenImages: await page.evaluate(() => [...document.images].filter((image) => !image.complete || !image.naturalWidth).length), heading: await page.locator("h1").textContent() });
          if (codePage.path === "/") await page.screenshot({ path: path.join(output, `${name}-${width === 1440 ? "desktop" : "mobile"}.png`), fullPage: true });
        }
      }
    }
  } finally { await browser.close(); }
  await writeFile(path.join(output, "browser-review.json"), JSON.stringify(review, null, 2));
  console.log(JSON.stringify({ mode: reviewExisting ? "existing-artifact" : "live-generation", model: result.model || null, reviewedPages: review.length, overflowFailures: review.filter((item) => item.overflow), imageFailures: review.filter((item) => item.brokenImages), artifacts: output, isolatedUsage: usageDir }));
  if (review.some((item) => item.overflow)) throw new Error("The live-generated website has viewport overflow. Review the generated artifact before publishing.");
  if (review.some((item) => item.brokenImages)) throw new Error("Some Pexels photographs did not load. Inspect browser-review.json and retry the review before publishing.");
}

main().catch((error) => {
  let message = error instanceof Error ? error.message : "Live website verification failed.";
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (key) message = message.replaceAll(key, "[redacted]");
  console.error(message); process.exitCode = 1;
});
