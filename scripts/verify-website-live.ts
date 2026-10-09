// Explicit live-provider check. Uses fictional knowledge and configured OpenRouter models/credits.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { makePlan, makeWebsite } from "../lib/generator";
import { prepareMedia, resolvePhotos } from "../lib/pexels";
import { readGeneratedSiteRecord, saveGeneratedSite } from "../lib/site-store";
import { emptyKnowledge, type Artifact } from "../lib/types";

loadEnvConfig(process.cwd());
async function main() {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  assert.ok(
    process.env.PEXELS_API_KEY?.trim(),
    "Configure PEXELS_API_KEY before this explicit live check.",
  );
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "everonn-website-live-"),
  );
  const previousDirectory = process.env.GENERATED_SITES_DIR;
  process.env.GENERATED_SITES_DIR = directory;
  const knowledge = {
    ...emptyKnowledge,
    businessName: "Harbor Climate Studio",
    businessType: "Residential heating and cooling services",
    description:
      "This fictional business provides heating and cooling installation, seasonal maintenance and equipment troubleshooting for homeowners. Its approach emphasizes explaining equipment choices, checking the needs of each home and keeping work areas tidy. The website should explain these services clearly with a distinctive professional design. No phone, email, location, price, guarantee or customer testimonial is supplied.",
    services: [
      {
        name: "Heating installation",
        description:
          "Helping homeowners understand equipment options and installing suitable heating systems.",
      },
      {
        name: "Seasonal maintenance",
        description:
          "Inspecting heating and cooling equipment and explaining recommended care.",
      },
    ],
  };
  const accepted: Artifact[] = [];
  try {
    const media = await prepareMedia(["heat pump equipment"]);
    assert.ok(
      media.photos.length,
      `Pexels returned no photos: ${media.warnings.join(" ")}`,
    );
    const sample = await fetch(media.photos[0].url, {
      method: "HEAD",
      signal: AbortSignal.timeout(20000),
    });
    assert.ok(
      sample.ok && sample.headers.get("content-type")?.startsWith("image/"),
    );
    console.log(
      JSON.stringify({
        stage: "pexels",
        photos: media.photos.length,
        imageAvailable: true,
      }),
    );
    if (process.argv.includes("--media-only")) return;
    assert.ok(
      key,
      "Pexels verified. Configure OPENROUTER_API_KEY to test live website generation and edits.",
    );
    await mkdir("artifacts", { recursive: true });
    const modelOverride = process.argv
      .find((arg) => arg.startsWith("--model="))
      ?.slice(8);
    const savedPlan = process.argv.includes("--resume")
      ? await readFile("artifacts/live-plan.json", "utf8")
          .then(JSON.parse)
          .catch(() => null)
      : null;
    const plan = savedPlan ?? (await makePlan(key, knowledge, null));
    await writeFile("artifacts/live-plan.json", JSON.stringify(plan));
    console.log(
      JSON.stringify({
        stage: "plan",
        model: plan.model,
        directions: plan.directions.map((d, i) => ({
          name: d.name,
          photos: plan.media[i].photos.length,
          warnings: plan.media[i].warnings,
        })),
      }),
    );
    const count = process.argv.includes("--all") ? 3 : 1;
    for (let index = 0; index < count; index++) {
      let invalidAttempt = 0;
      const previousArtifact = process.argv.includes("--resume")
        ? await readFile(`artifacts/live-artifact-${index}.json`, "utf8")
            .then(JSON.parse)
            .catch(() => null)
        : null;
      if (previousArtifact) {
        accepted.push(await saveGeneratedSite(knowledge, previousArtifact));
        continue;
      }
      const photos = await resolvePhotos(
        plan.media[index].photos.map((p) => p.id),
      );
      const artifact = await makeWebsite(
        key,
        knowledge,
        null,
        plan.directions[index],
        index,
        accepted,
        undefined,
        modelOverride,
        photos,
        undefined,
        (message) =>
          console.log(JSON.stringify({ stage: "progress", index, message })),
        async (html) => {
          await writeFile(
            `artifacts/live-invalid-${index}-${++invalidAttempt}.html`,
            html,
          );
        },
      );
      const saved = await saveGeneratedSite(knowledge, artifact);
      accepted.push(saved);
      await writeFile(
        `artifacts/live-artifact-${index}.json`,
        JSON.stringify(saved),
      );
      await mkdir("artifacts", { recursive: true });
      await writeFile(`artifacts/live-version-${index + 1}.html`, saved.html);
      console.log(
        JSON.stringify({
          stage: "generate",
          index,
          model: saved.model,
          path: saved.path,
          htmlBytes: Buffer.byteLength(saved.html),
          warnings: saved.warnings,
        }),
      );
    }
    const before = await readGeneratedSiteRecord("harbor-climate-studio", "1");
    const prompt =
      "Keep the established visual identity and supplied business facts, but give the services section a more spacious layout and larger headings. Add a working in-page link labelled Explore our services pointing to that section. Preserve existing image credits.";
    const edited = await makeWebsite(
      key,
      knowledge,
      null,
      plan.directions[0],
      0,
      accepted.slice(1),
      undefined,
      modelOverride,
      before!.artifact.photos,
      { artifact: before!.artifact, prompt },
      (message) =>
        console.log(JSON.stringify({ stage: "progress", index: 0, message })),
    );
    const savedEdit = await saveGeneratedSite(
      knowledge,
      edited,
      null,
      before!.artifact.id,
    );
    const after = await readGeneratedSiteRecord("harbor-climate-studio", "1");
    assert.equal(savedEdit.path, before?.artifact.path);
    assert.notEqual(savedEdit.id, before?.artifact.id);
    assert.equal(after?.knowledgeJson, before?.knowledgeJson);
    assert.ok(savedEdit.html.toLowerCase().includes("explore our services"));
    await writeFile("artifacts/live-edited-version-1.html", savedEdit.html);
    console.log(
      JSON.stringify({
        stage: "refine",
        model: savedEdit.model,
        pathUnchanged: true,
        assistantKnowledgeUnchanged: true,
        htmlBytes: Buffer.byteLength(savedEdit.html),
        warnings: savedEdit.warnings,
      }),
    );
  } finally {
    if (previousDirectory === undefined) delete process.env.GENERATED_SITES_DIR;
    else process.env.GENERATED_SITES_DIR = previousDirectory;
    assert.equal(
      path.dirname(path.resolve(directory)),
      path.resolve(os.tmpdir()),
    );
    assert.ok(path.basename(directory).startsWith("everonn-website-live-"));
    await rm(directory, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Live website check failed.",
  );
  process.exitCode = 1;
});
