// Explicit opt-in only: creates one fictional site, using paid provider calls and isolated files.
import { loadEnvConfig } from "@next/env";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createSite, readSite, buildSite, publishSite } from "../features/waas/service";
import { createWebsiteJobRunner } from "../features/website-studio/jobs";
import { exportSite, renderPage } from "../features/waas/render";
import { WEBSITE_CONCEPTS } from "../features/website-studio/generator";
import { readUsageEvents } from "../lib/usage-store";

async function main() {
  const args = process.argv.slice(2);
  if (!args.includes("--live")) throw new Error("Use --live to explicitly enable real provider calls.");
  const option = (name: string) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  loadEnvConfig(path.resolve(option("--env-dir") || "."), true, { info() {}, error() {} });
  if (option("--model")) process.env.GEMINI_WEBSITE_MODELS = option("--model");
  if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) throw new Error("Configure a Gemini key first.");
  const directory = await mkdtemp(path.join(tmpdir(), "waas-live-"));
  process.env.WAAS_DATA_DIR = directory; process.env.DATABASE_URL = ""; process.env.WAAS_ALLOW_LOCAL_STORAGE = "true";
  try {
    const summary = await createSite({
      profile: {
        businessName: "Willow Door Workshop", businessType: "Carpentry",
        description: "A fictional residential carpentry business in Hyderabad. We repair and adjust interior doors for local households. Customers contact us to discuss their repair request.",
        email: "hello@willow.example", phone: "+15550142555", location: "Hyderabad", serviceArea: "Hyderabad",
        timeZone: "Asia/Kolkata", hours: "Monday to Friday, 9 am to 5 pm", verified: true,
        services: [{ id: "doors", name: "Interior door repair", description: "Repair and adjustment of residential interior doors." }],
        knowledge: [{ question: "How do I request a quote?", answer: "Contact the team with details of your interior door repair request.", approved: true }],
      },
      actions: { booking: "https://willow.example/contact" },
      preferences: { brief: "A restrained, warm carpentry design. Use clear navigation and a working contact path." },
    });
    let result = await buildSite(summary.id, { operation: "start" });
    let last = "", resumes = 0;
    for (let step = 0; step < 150 && !result.project; step++) {
      if (!result.job) throw new Error("No saved job returned.");
      if (result.job.progress.message !== last) { last = result.job.progress.message; console.log(last); }
      if (result.job.status === "failed") {
        if (!result.job.canResume || resumes++ >= 2) throw new Error(result.job.error || "Live generation failed.");
        result = await buildSite(summary.id, { operation: "resume", jobId: result.job.id });
      } else {
        await new Promise((resolve) => setTimeout(resolve, result.job?.retryAfterMs || 100));
        // Recreate the runner between calls to prove saved state drives the work.
        result = await createWebsiteJobRunner().advance({ workspaceId: summary.id, role: "owner" }, result.job.id);
      }
    }
    if (!result.project) throw new Error("Live generation exceeded its review step limit.");
    const site = await readSite(summary.id), project = site.websiteProject!;
    let pages = 0;
    for (const concept of WEBSITE_CONCEPTS) for (const page of project.spec.code!.concepts[concept].pages) {
      renderPage(site, project, site.profile, page.path, concept, "/preview/" + project.privateToken, true); pages++;
    }
    await publishSite(site.workspaceId, { approved: true, concept: "editorial", draftId: project.id, expectedLiveReleaseId: null });
    const bundle = exportSite(await readSite(site.workspaceId));
    const events = await readUsageEvents(site.workspaceId);
    console.log("Real provider verification passed: " + pages + " validated pages across three designs, " + bundle.pages.length + " exported pages, " + events.length + " metered requests. Only isolated fictional data was used.");
  } finally { await rm(directory, { recursive: true, force: true }); }
}
void main().catch((error) => { console.error(error instanceof Error ? error.message : "Live verification failed."); process.exitCode = 1; });
