import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  downloadedPageLinks,
  pageLinks,
  servedPageLinks,
  zipFiles,
} from "../lib/site-pages";
import { validateWebsite } from "../lib/validation";
import {
  readGeneratedSite,
  saveGeneratedSite,
  saveSitePage,
  SiteRevisionConflict,
} from "../lib/site-store";
import { POST as planPages } from "../app/api/site-pages/plan/route";
import { POST as buildPage } from "../app/api/site-pages/build/route";
import { GET as servePage } from "../app/service/[business]/[version]/[page]/route";
import { GET as serveHome } from "../app/service/[business]/[version]/route";
import { brief, model, website } from "./fixtures";
import type { Artifact } from "../lib/types";

const homeNav =
  '<nav><a href="#services">Services</a><a href="#contact">Contact</a></nav>';
const linkedHome = () =>
  website().replace(
    homeNav,
    '<nav><a href="#services">Services</a><a href="page:about">About</a><a href="#contact">Contact</a></nav>',
  );
const aboutPage = () =>
  website()
    .replace(
      homeNav,
      '<nav><a href="page:home">Home</a><a href="page:about" aria-current="page">About</a><a href="page:home#contact">Contact</a></nav>',
    )
    .replace("Northline: comfort at home", "About Northline")
    .replace("<title>Northline", "<title>About Northline");
const direction = {
  name: "Original direction",
  concept: "A refined business-specific direction.",
  palette: ["#234321", "#fafbf4", "#abc987"],
  typography: "Readable editorial typography",
  composition: "Original service-led composition for this business.",
  imageQueries: ["home heating"],
};
const plannedPages = [
  {
    slug: "about",
    title: "About",
    purpose: "How Northline works with homeowners across the city.",
  },
];

test("page links resolve to served URLs, downloaded files and fall back to home", () => {
  const html =
    '<a href="page:about">A</a><a href=\'page:menu#tea\'>M</a><a href="page:home#contact">C</a>';
  assert.deepEqual(pageLinks(html), [
    { slug: "about", fragment: "" },
    { slug: "menu", fragment: "#tea" },
    { slug: "home", fragment: "#contact" },
  ]);
  assert.equal(
    servedPageLinks(html, "/service/tea/2", ["about"]),
    '<a href="/service/tea/2/about">A</a><a href=\'/service/tea/2#tea\'>M</a><a href="/service/tea/2#contact">C</a>',
  );
  assert.equal(
    downloadedPageLinks(html, ["about", "menu"]),
    '<a href="about.html">A</a><a href=\'menu.html#tea\'>M</a><a href="index.html#contact">C</a>',
  );
});
test("site download is a valid stored zip", () => {
  const zip = zipFiles([
    { name: "index.html", content: "hello" },
    { name: "about.html", content: "<p>About</p>" },
  ]);
  const view = new DataView(zip.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint32(14, true), 0x3610a686); // crc32("hello")
  const end = zip.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 10, true), 2);
  const centralStart = view.getUint32(end + 16, true);
  assert.equal(view.getUint32(centralStart, true), 0x02014b50);
});
test("page links are only valid for this site's pages; inner pages need not repeat every service", () => {
  assert.doesNotThrow(() =>
    validateWebsite(linkedHome(), brief, [], null, [], {
      pageSlugs: ["about"],
    }),
  );
  assert.throws(
    () => validateWebsite(linkedHome(), brief),
    /Link only to this site's pages/,
  );
  const inner = aboutPage()
    .replace("<h2>AC installation</h2>", "<h2>Our approach</h2>")
    .replace(/<a href="tel:[^"]+">[^<]+<\/a>/, "");
  assert.throws(
    () => validateWebsite(inner, brief, [], null, [], { pageSlugs: ["about"] }),
    /AC installation/,
  );
  assert.doesNotThrow(() =>
    validateWebsite(inner, brief, [], null, [], {
      pageSlugs: ["about"],
      subpage: true,
    }),
  );
  assert.throws(
    () =>
      validateWebsite(
        inner.replace("</main>", '<a href="tel:+19995550000">Call</a></main>'),
        brief,
        [],
        null,
        [],
        { pageSlugs: ["about"], subpage: true },
      ),
    /invented phone/,
  );
});
test("build full site plans pages, builds them concurrently with home links and serves every page", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "everonn-pages-"));
  const previous = {
    directory: process.env.GENERATED_SITES_DIR,
    key: process.env.OPENROUTER_API_KEY,
    token: process.env.STUDIO_ACCESS_TOKEN,
    models: process.env.OPENROUTER_MODELS,
    provider: process.env.WEBSITE_PROVIDER,
    fetch: globalThis.fetch,
  };
  process.env.GENERATED_SITES_DIR = directory;
  process.env.OPENROUTER_API_KEY = "sk-or-v1-test-server-key";
  process.env.OPENROUTER_MODELS = model.id;
  process.env.STUDIO_ACCESS_TOKEN = "test-token";
  delete process.env.WEBSITE_PROVIDER;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/models"))
      return Response.json({ data: [model] });
    const body = JSON.parse(String(init?.body));
    const prompt = JSON.stringify(body.messages);
    const content = body.response_format
      ? JSON.stringify({ pages: plannedPages })
      : prompt.includes("inner page")
        ? aboutPage()
        : linkedHome();
    return Response.json({
      model: model.id,
      choices: [{ finish_reason: "stop", message: { content } }],
    });
  };
  const post = (handler: typeof planPages, route: string, body: object) =>
    handler(
      new Request(`https://studio.example/api/site-pages/${route}`, {
        method: "POST",
        headers: {
          origin: "https://studio.example",
          "Content-Type": "application/json",
          "x-studio-token": "test-token",
        },
        body: JSON.stringify(body),
      }),
    );
  try {
    const original: Artifact = {
      id: "home-revision-1",
      designId: "home-revision-1",
      index: 0,
      name: direction.name,
      rationale: "Test design",
      html: validateWebsite(website(), brief).html,
      model: model.id,
      createdAt: new Date().toISOString(),
      warnings: [],
      direction,
    };
    await saveGeneratedSite(brief, original);
    const identity = {
      business: "northline",
      version: "1",
      revision: original.id,
    };
    const planned = await post(planPages, "plan", identity);
    assert.equal(planned.status, 200);
    const { pages } = await planned.json();
    // No crawl in this fixture, so no source URLs survive the crawled-URL filter.
    assert.deepEqual(
      pages,
      plannedPages.map((p) => ({ ...p, sources: [] })),
    );

    const [about, home] = await Promise.all(
      ["about", "home"].map((target) =>
        post(buildPage, "build", { ...identity, pages, target }),
      ),
    );
    assert.equal(about.status, 200, JSON.stringify(await about.clone().json()));
    assert.equal(home.status, 200, JSON.stringify(await home.clone().json()));

    const saved = (await readGeneratedSite("northline", "1"))!;
    assert.notEqual(saved.id, original.id);
    assert.equal(saved.designId, original.designId);
    assert.ok(saved.html.includes('href="page:about"'));
    assert.deepEqual(
      saved.pages?.map((p) => p.slug),
      ["about"],
    );

    const params = { business: "northline", version: "1" };
    const served = await servePage(new Request("https://studio.example"), {
      params: Promise.resolve({ ...params, page: "about" }),
    });
    assert.equal(served.status, 200);
    const aboutHtml = await served.text();
    assert.ok(aboutHtml.includes('href="/service/northline/1"'));
    assert.ok(aboutHtml.includes('href="/service/northline/1#contact"'));
    assert.ok(aboutHtml.includes("everonn-assistant-size"));
    const homeHtml = await (
      await serveHome(new Request("https://studio.example"), {
        params: Promise.resolve(params),
      })
    ).text();
    assert.ok(homeHtml.includes('href="/service/northline/1/about"'));
    const missing = await servePage(new Request("https://studio.example"), {
      params: Promise.resolve({ ...params, page: "pricing" }),
    });
    assert.equal(missing.status, 404);

    // Regenerating the version replaces the design: pages are dropped and late
    // page saves from the old design are rejected.
    await saveGeneratedSite(brief, {
      ...original,
      id: "home-revision-2",
      designId: "home-revision-2",
    });
    assert.equal((await readGeneratedSite("northline", "1"))?.pages, undefined);
    await assert.rejects(
      saveSitePage("northline", "1", saved.pages![0], {
        designId: original.designId!,
      }),
      SiteRevisionConflict,
    );
  } finally {
    globalThis.fetch = previous.fetch;
    for (const [name, value] of [
      ["GENERATED_SITES_DIR", previous.directory],
      ["OPENROUTER_API_KEY", previous.key],
      ["STUDIO_ACCESS_TOKEN", previous.token],
      ["OPENROUTER_MODELS", previous.models],
      ["WEBSITE_PROVIDER", previous.provider],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
