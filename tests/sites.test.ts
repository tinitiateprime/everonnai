import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  businessSlug,
  readGeneratedSite,
  saveGeneratedSite,
  websitePath,
} from "../lib/site-store";
import { GET } from "../app/service/[business]/[version]/route";
import { POST } from "../app/api/generate/route";
import { brief, model, website } from "./fixtures";
import type { Artifact } from "../lib/types";

const artifact = (index: number): Artifact => ({
  id: `test-version-${index + 1}`,
  index,
  name: `Direction ${index + 1}`,
  rationale: "A distinct business-specific website.",
  html: website(`Northline version ${index + 1}`),
  model: model.id,
  createdAt: new Date().toISOString(),
  warnings: [],
});
test("business names become safe readable paths and legacy unnamed slugs remain readable", () => {
  assert.equal(
    businessSlug("Northline Heating & Air", ""),
    "northline-heating-air",
  );
  assert.equal(businessSlug("  Café   Élan  ", ""), "cafe-elan");
  assert.equal(businessSlug("CON", ""), "con-business");
  assert.equal(businessSlug("../ACME\\Heating", ""), "acme-heating");
  assert.ok(businessSlug("", "Bakery").startsWith("business-"));
  assert.notEqual(businessSlug("", "Bakery"), businessSlug("", "Plumber"));
  assert.equal(
    websitePath("northline-heating", 0),
    "/service/northline-heating/1",
  );
  assert.equal(
    websitePath("northline-heating", 2),
    "/service/northline-heating/3",
  );
  assert.throws(() => websitePath("../outside", 0));
  assert.throws(() => websitePath("northline", 3));
});
test("three versions persist independently, overwrite atomically and serve as isolated standalone HTML", async () => {
  const originalDirectory = process.env.GENERATED_SITES_DIR;
  const directory = await mkdtemp(path.join(os.tmpdir(), "everonn-site-test-"));
  process.env.GENERATED_SITES_DIR = directory;
  try {
    for (let index = 0; index < 3; index++) {
      const saved = await saveGeneratedSite(brief, artifact(index));
      assert.equal(saved.path, `/service/northline/${index + 1}`);
      assert.equal(
        (await readGeneratedSite("northline", String(index + 1)))?.id,
        artifact(index).id,
      );
      const response = await GET(
        new Request(`https://studio.example${saved.path}`),
        {
          params: Promise.resolve({
            business: "northline",
            version: String(index + 1),
          }),
        },
      );
      assert.equal(response.status, 200);
      assert.ok(response.headers.get("content-type")?.includes("text/html"));
      assert.ok(
        response.headers
          .get("content-security-policy")
          ?.includes("script-src 'sha256-"),
      );
      assert.ok(
        response.headers
          .get("content-security-policy")
          ?.includes("frame-src 'self'"),
      );
      assert.equal(response.headers.get("cache-control"), "no-store");
      const document = await response.text();
      assert.ok(document.includes(`Northline version ${index + 1}`));
      assert.ok(document.includes("Business voice and chat assistant"));
      assert.ok(
        document.includes(`/assistant/northline/${index + 1}?revision=`),
      );
    }
    const updated = await saveGeneratedSite(brief, {
      ...artifact(1),
      id: "replacement-version-2",
    });
    assert.equal(updated.path, "/service/northline/2");
    assert.equal(
      (await readGeneratedSite("northline", "2"))?.id,
      "replacement-version-2",
    );
    assert.equal(
      (await readGeneratedSite("northline", "1"))?.id,
      "test-version-1",
    );
    assert.equal(
      (await readGeneratedSite("northline", "3"))?.id,
      "test-version-3",
    );
    for (const [business, version] of [
      ["missing", "1"],
      ["northline", "4"],
      ["northline", "01"],
      ["..", "1"],
      ["../outside", "1"],
    ]) {
      const response = await GET(
        new Request("https://studio.example/service/invalid/1"),
        { params: Promise.resolve({ business, version }) },
      );
      assert.equal(response.status, 404);
    }
    await writeFile(path.join(directory, "northline", "2.json"), "broken JSON");
    const corrupt = await GET(
      new Request("https://studio.example/service/northline/2"),
      { params: Promise.resolve({ business: "northline", version: "2" }) },
    );
    assert.equal(corrupt.status, 503);
    assert.ok(!(await corrupt.text()).includes(directory));
  } finally {
    if (originalDirectory === undefined) delete process.env.GENERATED_SITES_DIR;
    else process.env.GENERATED_SITES_DIR = originalDirectory;
    assert.equal(
      path.dirname(path.resolve(directory)),
      path.resolve(os.tmpdir()),
    );
    assert.ok(path.basename(directory).startsWith("everonn-site-test-"));
    await rm(directory, { recursive: true, force: true });
  }
});
test("generation API returns a usable persisted website URL after provider validation", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "everonn-site-test-"));
  const previous = {
    directory: process.env.GENERATED_SITES_DIR,
    key: process.env.OPENROUTER_API_KEY,
    token: process.env.STUDIO_ACCESS_TOKEN,
    fetch: globalThis.fetch,
  };
  process.env.GENERATED_SITES_DIR = directory;
  process.env.OPENROUTER_API_KEY = "sk-or-v1-test-server-key";
  process.env.STUDIO_ACCESS_TOKEN = "test-token";
  globalThis.fetch = async (url) =>
    String(url).endsWith("/models")
      ? Response.json({ data: [model] })
      : Response.json({
          model: model.id,
          choices: [{ finish_reason: "stop", message: { content: website() } }],
        });
  try {
    const response = await POST(
      new Request("https://studio.example/api/generate", {
        method: "POST",
        headers: {
          origin: "https://studio.example",
          "Content-Type": "application/json",
          "x-studio-token": "test-token",
        },
        body: JSON.stringify({
          knowledge: brief,
          direction: {
            name: "Original direction",
            concept: "A refined business-specific direction.",
            palette: ["#234321", "#fafbf4", "#abc987"],
            typography: "Readable editorial typography",
            composition: "Original service-led composition for this business.",
          },
          index: 2,
        }),
      }),
    );
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.artifact.path, "/service/northline/3");
    assert.ok(
      (await readGeneratedSite("northline", "3"))?.html.includes(
        "Content-Security-Policy",
      ),
    );
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
    assert.ok(path.basename(directory).startsWith("everonn-site-test-"));
    await rm(directory, { recursive: true, force: true });
  }
});
