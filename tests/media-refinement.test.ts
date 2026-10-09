import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { searchPhotos, resolvePhotos, prepareMedia } from "../lib/pexels";
import { validateWebsite } from "../lib/validation";
import {
  readGeneratedSiteRecord,
  saveGeneratedSite,
  SiteRevisionConflict,
} from "../lib/site-store";
import { POST } from "../app/api/refine/route";
import { brief, model, website } from "./fixtures";
import type { Artifact, Direction } from "../lib/types";

const providerPhoto = {
  id: 700001,
  width: 2200,
  height: 1400,
  photographer: "Test Photographer",
  photographer_url: "https://www.pexels.com/@test-photographer/",
  url: "https://www.pexels.com/photo/test-photo-700001/",
  alt: "Illustrative equipment photograph",
  src: {
    large2x:
      "https://images.pexels.com/photos/700001/pexels-photo-700001.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
  },
};
test("Pexels searches are cached, IDs are verified server-side, failures stay explicit, and credits are required", async () => {
  const original = { fetch: globalThis.fetch, key: process.env.PEXELS_API_KEY };
  process.env.PEXELS_API_KEY = "private-pexels-test-secret";
  let requests = 0;
  globalThis.fetch = async (url, options) => {
    requests++;
    assert.equal(
      new Headers(options?.headers).get("authorization"),
      "private-pexels-test-secret",
    );
    assert.ok(!String(url).includes("secret"));
    return Response.json(
      String(url).includes("/search?")
        ? {
            photos: [
              providerPhoto,
              {
                ...providerPhoto,
                id: 700002,
                src: { large2x: "http://127.0.0.1/secret" },
              },
            ],
          }
        : providerPhoto,
    );
  };
  try {
    const photos = await searchPhotos("heating equipment test");
    assert.equal(photos.length, 1);
    assert.equal((await searchPhotos("heating equipment test"))[0].id, 700001);
    assert.equal(
      (await resolvePhotos([700001]))[0].photographer,
      "Test Photographer",
    );
    assert.equal(requests, 1);
    await assert.rejects(resolvePhotos([999999]), /no longer available/);
    const image = `<img src="${photos[0].url}" alt="Illustrative equipment">`;
    const withImage = website().replace("</main>", `${image}</main>`);
    assert.throws(
      () => validateWebsite(withImage, brief, [], null, photos),
      /Pexels credit/,
    );
    const credit = `<p>Photography: <a href="https://www.pexels.com/">Pexels</a>, <a href="${photos[0].sourceUrl}">Test Photographer</a>.</p>`;
    assert.ok(
      validateWebsite(
        withImage.replace("</footer>", `${credit}</footer>`),
        brief,
        [],
        null,
        photos,
      ).html.includes("Test Photographer"),
    );
    assert.throws(
      () =>
        validateWebsite(
          withImage.replace(
            "</footer>",
            `${credit.replace("Test Photographer", "Someone Else")}</footer>`,
          ),
          brief,
          [],
          null,
          photos,
        ),
      /Credit photographer/,
    );
    assert.throws(
      () =>
        validateWebsite(
          website().replace(
            "</main>",
            '<img src="https://images.pexels.com/invented.jpg" alt="Fake"></main>',
          ),
          brief,
        ),
      /exact supplied/,
    );
    const cssImage = website().replace(
      "body{",
      `body{background-image:url('${photos[0].url}');`,
    );
    assert.throws(
      () => validateWebsite(cssImage, brief, [], null, photos),
      /Pexels credit/,
    );
    await assert.rejects(searchPhotos("hello@example.com"), /without contact/);
    globalThis.fetch = async () => new Response("rate limit", { status: 429 });
    const limited = await prepareMedia(["fresh cooling equipment"]);
    assert.equal(limited.photos.length, 0);
    assert.match(limited.warnings[0], /rate limit/);
    assert.ok(!JSON.stringify(limited).includes("secret"));
    delete process.env.PEXELS_API_KEY;
    assert.match(
      (await prepareMedia(["equipment"])).warnings[0],
      /not configured/,
    );
  } finally {
    globalThis.fetch = original.fetch;
    if (original.key === undefined) delete process.env.PEXELS_API_KEY;
    else process.env.PEXELS_API_KEY = original.key;
  }
});

test("prompt edits load saved context, preserve siblings/assistant knowledge, reject stale revisions and retain accepted HTML on failure", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "everonn-edit-test-"));
  const previous = {
    fetch: globalThis.fetch,
    directory: process.env.GENERATED_SITES_DIR,
    key: process.env.OPENROUTER_API_KEY,
    token: process.env.STUDIO_ACCESS_TOKEN,
  };
  process.env.GENERATED_SITES_DIR = directory;
  process.env.OPENROUTER_API_KEY = "sk-or-v1-private-test";
  process.env.STUDIO_ACCESS_TOKEN = "test-edit-token";
  const direction: Direction = {
    name: "Editorial warmth",
    concept: "A business-specific identity with confident type.",
    composition: "An original spatial composition for residential service.",
    palette: ["#eee", "#222", "#789"],
    typography: "Original typography",
    imageQueries: ["heating equipment"],
  };
  const base: Artifact = {
    id: "before-edit",
    index: 0,
    name: direction.name,
    rationale: direction.concept,
    html: validateWebsite(website(), brief).html,
    model: model.id,
    warnings: [],
    createdAt: new Date().toISOString(),
    direction,
    photos: [],
  };
  const bodies: { messages: { content: string }[] }[] = [];
  let fail = false;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith("/models"))
      return Response.json({ data: [model] });
    bodies.push(JSON.parse(String(options?.body)));
    if (fail) return new Response("Unauthorized", { status: 401 });
    return Response.json({
      model: model.id,
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: website().replace("comfort at home", "A warmer home"),
          },
        },
      ],
    });
  };
  const request = (revision: string, prompt = "Make the heading warmer.") =>
    new Request("https://studio.example/api/refine", {
      method: "POST",
      headers: {
        origin: "https://studio.example",
        "Content-Type": "application/json",
        "x-studio-token": "test-edit-token",
      },
      body: JSON.stringify({
        business: "northline",
        version: "1",
        revision,
        prompt,
        knowledge: { businessName: "Forged client business" },
        html: "Forged client HTML",
      }),
    });
  try {
    await saveGeneratedSite(brief, base);
    await saveGeneratedSite(brief, {
      ...base,
      id: "sibling",
      index: 1,
      html: website("Northline sibling"),
    });
    const before = await readGeneratedSiteRecord("northline", "1");
    const response = await POST(request("before-edit"));
    assert.equal(response.status, 200);
    const { artifact } = await response.json();
    assert.equal(artifact.path, "/service/northline/1");
    assert.notEqual(artifact.id, "before-edit");
    assert.equal(artifact.edits[0].prompt, "Make the heading warmer.");
    const packet = JSON.stringify(bodies[0]);
    assert.ok(packet.includes("Website-building SKILL.md instructions"));
    assert.ok(
      packet.includes("currentHtml") &&
        packet.includes("ownerKnowledge") &&
        packet.includes("ownerChangeRequest"),
    );
    assert.ok(!packet.includes("Forged client"));
    assert.equal(
      (await readGeneratedSiteRecord("northline", "1"))?.knowledgeJson,
      before?.knowledgeJson,
    );
    assert.equal(
      (await readGeneratedSiteRecord("northline", "2"))?.artifact.id,
      "sibling",
    );
    const stale = await POST(request("before-edit"));
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).latestArtifact.id, artifact.id);
    assert.equal(bodies.length, 1);
    fail = true;
    assert.equal(
      (await POST(request(artifact.id, "Improve typography."))).status,
      400,
    );
    assert.equal(
      (await readGeneratedSiteRecord("northline", "1"))?.artifact.id,
      artifact.id,
    );
    assert.ok(JSON.stringify(bodies[1]).includes("acceptedChangeHistory"));
    const competing = await Promise.allSettled([
      saveGeneratedSite(brief, { ...base, id: "winner-a" }, null, artifact.id),
      saveGeneratedSite(brief, { ...base, id: "winner-b" }, null, artifact.id),
    ]);
    assert.equal(competing.filter((r) => r.status === "fulfilled").length, 1);
    assert.ok(
      competing.some(
        (r) =>
          r.status === "rejected" && r.reason instanceof SiteRevisionConflict,
      ),
    );
    assert.equal((await POST(request("winner-a", " "))).status, 400);
    const forbidden = new Request("https://studio.example/api/refine", {
      method: "POST",
      headers: { origin: "https://attacker.example" },
    });
    assert.equal((await POST(forbidden)).status, 400);
  } finally {
    globalThis.fetch = previous.fetch;
    for (const [name, value] of [
      ["GENERATED_SITES_DIR", previous.directory],
      ["OPENROUTER_API_KEY", previous.key],
      ["STUDIO_ACCESS_TOKEN", previous.token],
    ]) {
      if (value === undefined) delete process.env[name!];
      else process.env[name!] = value;
    }
    assert.equal(
      path.dirname(path.resolve(directory)),
      path.resolve(os.tmpdir()),
    );
    assert.ok(path.basename(directory).startsWith("everonn-edit-test-"));
    await rm(directory, { recursive: true, force: true });
  }
});
