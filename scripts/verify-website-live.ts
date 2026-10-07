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
  const resumeSaved = flags.includes("--resume-saved");
  const largeCatalogue = flags.includes("--large-catalogue");
  const savedSteps = flags.includes("--saved-steps") || resumeSaved;
  if (flags.some((flag) => !["--live", "--review-existing", "--saved-steps", "--resume-saved", "--large-catalogue"].includes(flag)) || live === reviewExisting || (savedSteps && !live)) {
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
  profile.workspaceId = largeCatalogue ? "isolated_carpentry_live_review" : "isolated_hvac_live_review";
  if (largeCatalogue) {
    const services = [
      ["Kitchen cabinetry", "Made-to-measure kitchen storage, with layout, measurements and finish choices reviewed with the customer."],
      ["Wardrobes", "Bedroom storage designed around the room and the customer's preferred hanging and shelf arrangements."],
      ["Wooden doors", "Wooden door fitting requests, with sizes, opening direction and finish confirmed before work is agreed."],
      ["Door frame repairs", "Assessment and repair requests for worn wooden door frames and their fit."],
      ["Window frame repairs", "Assessment and repair requests for existing wooden window frames."],
      ["Bookshelves", "Custom shelving requests for books and display, sized for the customer's available space."],
      ["Storage units", "Storage unit requests for household items, with dimensions and compartments agreed with the customer."],
      ["Furniture repairs", "Repair assessment requests for wooden chairs, tables and other wooden furniture."],
      ["Office partitions", "Wooden partition requests for offices, with dimensions and access needs reviewed before a quote."],
      ["Wooden wall panels", "Interior wooden panel requests, with wall measurements and finish preferences reviewed."],
      ["Custom desks", "Desk requests based on the customer's workspace dimensions and storage preferences."],
      ["On-site fitting", "Fitting requests for agreed wooden fixtures, subject to a site review and schedule confirmation."],
      ["Utility room cabinets", "Cabinet requests for utility rooms, sized around existing equipment and storage requirements."],
    ];
    profile = { ...profile, businessName: "Workshop & Grain", businessType: "Carpentry", skillId: "general",
      description: "A residential and small-office carpentry business in Denver. Customers can request made-to-measure cabinets, wardrobes, doors, shelving, furniture repairs, partitions and wooden interior fixtures. Measurements, design choices, material options, pricing and scheduling are confirmed by the team after reviewing each request.",
      email: "hello@workshop-grain.example", hours: "Monday to Friday, 8 AM to 6 PM", greeting: "Welcome to Workshop & Grain.",
      services: services.map(([name, description], index) => ({ id: `carpentry_${index}`, name, description, active: true })),
      knowledge: services.map(([name, description], index) => ({ id: `knowledge_${index}`, category: "faq" as const, question: `How do I request ${name.toLowerCase()}?`,
        answer: `${description} Please share the room or item dimensions if known, photographs of the existing space, a description of the problem or desired use, and any finish preferences. The team reviews these details and may ask for further measurements or a site visit. Material availability, final scope, pricing and an installation date are confirmed by a person. Customers should describe access constraints and existing fixtures before a visit. No price or completion time is promised until the details have been reviewed.`, approved: true, updatedAt: profile.updatedAt })) };
  }
  const memory = saveWebsiteMemory({ profile, actor: { workspaceId: profile.workspaceId, role: "owner", userId: "isolated-review" }, preferences: { ...EMPTY_WEBSITE_PREFERENCES, brief: `A premium, distinctive ${largeCatalogue ? "carpentry" : "heating and cooling"} website. Clear practical service choices, sophisticated typography and calm composition. Make each concept feel like an independently designed website. Use equipment and home interior photography, with no invented claims.`, imagery: "equipment" } });
  const usage = { workspaceId: profile.workspaceId, feature: "website_generation" as const };
  const output = path.join(process.cwd(), "artifacts", largeCatalogue ? "website-live-large" : "hvac-live");
  const reviewWorkspaceId = profile.workspaceId;
  await mkdir(output, { recursive: true });
  let result: { profile: BusinessProfile; spec: WebsiteSpec; model?: string };
  if (reviewExisting) {
    console.log("Reviewing the saved fictional website without new generation calls.");
    result = JSON.parse(await readFile(path.join(output, "website.json"), "utf8"));
    if (!result.spec?.code || result.profile?.workspaceId !== reviewWorkspaceId) {
      throw new Error("A complete fictional HVAC review artifact is required. Generate it with --live first.");
    }
    profile = result.profile;
    for (const concept of WEBSITE_CONCEPTS) {
      result.spec.code.concepts[concept] = normalizeWebsiteCodeConcept(result.spec.code.concepts[concept], result.spec, profile);
    }
  } else if (savedSteps) {
    const { createWebsiteJobRunner, WEBSITE_STEP_TIMEOUT_MS } = await import("../features/website-studio/jobs");
    let workspace = { ...createDemoWorkspace(), workspaceId: profile.workspaceId, profile, aiMemory: memory, websiteProject: null,
      contacts: [], leads: [], conversations: [], appointments: [] } as import("../features/everonn/types").EverOnnWorkspace;
    const checkpointFile = path.join(output, "job-checkpoint.json");
    if (resumeSaved) {
      workspace = JSON.parse(await readFile(checkpointFile, "utf8"));
      if (workspace.workspaceId !== reviewWorkspaceId || workspace.profile?.workspaceId !== workspace.workspaceId || !workspace.websiteGeneration) throw new Error("Only the matching saved fictional review can be resumed.");
      profile = workspace.profile;
    }
    const store: import("../features/website-studio/jobs").WebsiteJobStore = {
      read: async () => JSON.parse(await readFile(checkpointFile, "utf8")),
      update: async (_id, change) => {
        workspace = change(workspace);
        await writeFile(checkpointFile, JSON.stringify(workspace));
        return structuredClone(workspace);
      },
      slugUsed: async () => false,
    };
    const actor = { workspaceId: profile.workspaceId, role: "owner" as const };
    let status = resumeSaved ? await createWebsiteJobRunner({ store }).resume(actor, workspace.websiteGeneration!.id) : await createWebsiteJobRunner({ store }).start(actor);
    const id = status.job!.id;
    for (let step = 0; step < 500 && !status.project; step++) {
      // Reconstruct state from its saved checkpoint between every provider request.
      workspace = await store.read(actor.workspaceId);
      status = await createWebsiteJobRunner({ store }).advance(actor, id);
      console.log(JSON.stringify({ step, status: status.job?.status, progress: status.job?.progress, providerCallBudgetMs: WEBSITE_STEP_TIMEOUT_MS }));
      if (status.job?.status === "failed") throw new Error(status.job.error);
    }
    if (!status.project) throw new Error("The saved generation steps did not produce a completed draft.");
    result = { profile, spec: status.project.spec, model: status.project.generation?.model };
    await writeFile(path.join(output, "website.json"), JSON.stringify(result, null, 2));
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
  console.log(JSON.stringify({ mode: reviewExisting ? "existing-artifact" : savedSteps ? "live-saved-steps" : "live-generation", model: result.model || null, reviewedPages: review.length, overflowFailures: review.filter((item) => item.overflow), imageFailures: review.filter((item) => item.brokenImages), artifacts: output, isolatedUsage: usageDir }));
  if (review.some((item) => item.overflow)) throw new Error("The live-generated website has viewport overflow. Review the generated artifact before publishing.");
  if (review.some((item) => item.brokenImages)) throw new Error("Some Pexels photographs did not load. Inspect browser-review.json and retry the review before publishing.");
}

main().catch((error) => {
  let message = error instanceof Error ? error.message : "Live website verification failed.";
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (key) message = message.replaceAll(key, "[redacted]");
  console.error(message); process.exitCode = 1;
});
