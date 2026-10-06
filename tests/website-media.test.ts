import assert from "node:assert/strict";
import test from "node:test";
import { createDemoWorkspace } from "../features/everonn/demo-data";
import { generateDeterministicWebsiteSpec } from "./fixtures/website";
import { resolveWebsiteMedia } from "../features/website-studio/media";

test("Pexels media populates hero, service, and gallery placements without duplicates", async () => {
  const profile = createDemoWorkspace().profile;
  const spec = generateDeterministicWebsiteSpec(profile);
  const photos = Array.from({ length: 12 }, (_, index) => ({
    id: index + 1,
    width: 1800,
    height: 1200,
    photographer: `Photographer ${index + 1}`,
    url: `https://www.pexels.com/photo/${index + 1}/`,
    alt: `Relevant business image ${index + 1}`,
    src: { large2x: `https://images.pexels.com/photos/${index + 1}/photo-${index + 1}.jpeg?auto=compress` },
  }));
  const fetchImpl = async () => new Response(JSON.stringify({ photos }), { status: 200, headers: { "Content-Type": "application/json" } });

  const media = await resolveWebsiteMedia(spec, profile, { apiKey: "test-pexels-key", fetchImpl: fetchImpl as typeof fetch });
  const assets = [media.hero, media.story, ...Object.values(media.services), ...media.gallery].filter(Boolean);

  assert.equal(media.provider, "pexels");
  assert.ok(media.hero);
  assert.ok(media.story);
  assert.equal(Object.keys(media.services).length, profile.services.filter((service) => service.active).length);
  assert.equal(media.gallery.length, 6);
  assert.equal(new Set(assets.map((asset) => asset?.id)).size, assets.length);
});

test("a Pexels outage returns empty assets and an explicit warning", async () => {
  const profile = createDemoWorkspace().profile;
  const spec = generateDeterministicWebsiteSpec(profile);
  const fetchImpl = async () => new Response(JSON.stringify({ error: "unavailable" }), { status: 503 });

  const media = await resolveWebsiteMedia(spec, profile, { apiKey: "test-pexels-key", fetchImpl: fetchImpl as typeof fetch });

  assert.equal(media.provider, "none");
  assert.equal(media.hero, null);
  assert.equal(media.story, null);
  assert.equal(media.gallery.length, 0);
  assert.match(media.warning || "", /searches could not be completed/);
});
