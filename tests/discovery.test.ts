import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { discoverWebsite } from "../lib/crawler";
import {
  saveCrawl,
  readCrawl,
  snapshotDiscovery,
  generationDiscovery,
  withCrawlLock,
} from "../lib/discovery-store";
import { discoverySchema } from "../lib/input";
import { crawlSettings, MAX_CRAWL_PAGES } from "../lib/crawl-limits";
import { knowledgePacket } from "../lib/prompts";
import { extractPage } from "../lib/extract";
import { brief } from "./fixtures";
import type { CrawlState, Discovery } from "../lib/types";

function fixtureSite(total: number) {
  const origin = "https://large-business.example";
  const calls = new Map<string, number>();
  let active = 0,
    peak = 0;
  const resource = async (url: string) => {
    const route = new URL(url).pathname;
    calls.set(route, (calls.get(route) ?? 0) + 1);
    active++;
    peak = Math.max(active, peak);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active--;
    if (route === "/robots.txt")
      return {
        url,
        status: 200,
        headers: { "content-type": "text/plain" },
        body: Buffer.from(`User-agent: *\nSitemap: ${origin}/sitemap.xml`),
      };
    if (route === "/sitemap.xml")
      return {
        url,
        status: 200,
        headers: { "content-type": "application/xml" },
        body: Buffer.from(
          `<urlset>${Array.from({ length: total }, (_, i) => `<url><loc>${origin}/page-${i}</loc></url>`).join("")}</urlset>`,
        ),
      };
    if (route === "/sitemap_index.xml")
      return {
        url,
        status: 404,
        headers: { "content-type": "text/plain" },
        body: Buffer.from(""),
      };
    return {
      url,
      status: 200,
      headers: { "content-type": "text/html" },
      body: Buffer.from(
        `<html><head><title>Business ${route}</title></head><body><h1>Services ${route}</h1><p>Professional services and clear equipment guidance for this specific location.</p></body></html>`,
      ),
    };
  };
  return { origin, resource, calls, peak: () => peak };
}
test("crawl checkpoints resume beyond 40, extend their cap, avoid duplicate requests and freeze generation evidence", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "everonn-crawl-test-"),
  );
  const previousRoot = process.env.CRAWL_STORAGE_DIR;
  process.env.CRAWL_STORAGE_DIR = directory;
  const site = fixtureSite(90);
  const dependencies = {
    browser: null,
    resource: site.resource,
    batchPages: 20,
    maxPages: 40,
    onCheckpoint: saveCrawl,
  };
  try {
    let result = await discoverWebsite(
      site.origin,
      () => {},
      undefined,
      dependencies,
    );
    assert.equal(result.pages.length, 20);
    assert.equal(result.crawl?.canContinue, true);
    assert.ok(discoverySchema.safeParse(result).success);
    const id = result.crawl!.id;
    result = await discoverWebsite(site.origin, () => {}, undefined, {
      ...dependencies,
      resume: await readCrawl(id),
    });
    assert.equal(result.pages.length, 40);
    assert.equal(result.crawl?.canContinue, false);
    assert.equal(result.crawl?.canExtend, true);
    const snapshotId = await snapshotDiscovery(result);
    result = await discoverWebsite(site.origin, () => {}, undefined, {
      ...dependencies,
      maxPages: 100,
      resume: await readCrawl(id),
    });
    assert.equal(result.pages.length, 60);
    while (result.crawl?.canContinue)
      result = await discoverWebsite(site.origin, () => {}, undefined, {
        ...dependencies,
        maxPages: 100,
        resume: await readCrawl(id),
      });
    assert.equal(result.pages.length, 91);
    assert.equal(result.complete, true);
    assert.equal(site.calls.get("/"), 1);
    for (let i = 0; i < 90; i++) assert.equal(site.calls.get(`/page-${i}`), 1);
    assert.ok(site.peak() > 1 && site.peak() <= 4);
    assert.equal(
      (await generationDiscovery({ sourceSnapshotId: snapshotId }))?.pages
        .length,
      40,
    );
    assert.equal(
      (await generationDiscovery({ discoveryId: id }))?.pages.length,
      91,
    );
    await assert.rejects(
      discoverWebsite("https://different.example", () => {}, undefined, {
        ...dependencies,
        resume: await readCrawl(id),
      }),
      /same website/,
    );
    let release!: () => void;
    const active = withCrawlLock(
      id,
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await assert.rejects(
      withCrawlLock(id, async () => {}),
      /already running/,
    );
    release();
    await active;
  } finally {
    if (previousRoot === undefined) delete process.env.CRAWL_STORAGE_DIR;
    else process.env.CRAWL_STORAGE_DIR = previousRoot;
    assert.equal(
      path.dirname(path.resolve(directory)),
      path.resolve(os.tmpdir()),
    );
    assert.ok(path.basename(directory).startsWith("everonn-crawl-test-"));
    await rm(directory, { recursive: true, force: true });
  }
});
test("cancellation preserves the completed page and resumable cursor; old browser discoveries can continue", async () => {
  const site = fixtureSite(45);
  const controller = new AbortController();
  let saved: CrawlState | undefined;
  const partial = await discoverWebsite(
    site.origin,
    () => {},
    controller.signal,
    {
      resource: site.resource,
      browser: null,
      onCheckpoint: async (state) => {
        saved = structuredClone(state);
        if (state.result.pages.length) controller.abort();
      },
    },
  );
  assert.equal(partial.pages.length, 1);
  assert.equal(partial.crawl?.canContinue, true);
  const resumed = await discoverWebsite(site.origin, () => {}, undefined, {
    resource: site.resource,
    browser: null,
    resume: saved!,
    batchPages: 60,
  });
  assert.equal(resumed.pages.length, 46);
  assert.equal(site.calls.get("/"), 1);
  const legacy = {
    ...resumed,
    pages: resumed.pages.slice(0, 40),
    complete: false,
    crawl: undefined,
  };
  const transferred = await discoverWebsite(site.origin, () => {}, undefined, {
    resource: site.resource,
    browser: null,
    previous: legacy,
    batchPages: 100,
  });
  assert.equal(transferred.pages.length, 46);
  assert.equal(new Set(transferred.pages.map((p) => p.url)).size, 46);
});
test("large knowledge stays bounded, retains late business contacts, and validates the expanded hard limit", () => {
  const page = extractPage(
    "<html><head><title>Business archive</title></head><body><h1>Article</h1><p>Useful article details.</p></body></html>",
    "https://business.example/",
  );
  const pages = Array.from({ length: MAX_CRAWL_PAGES }, (_, i) => ({
    ...page,
    url: `https://business.example/page-${i}`,
    text: "Detailed source evidence. ".repeat(450),
  }));
  pages[1999] = {
    ...pages[1999],
    title: "Business hours and contact",
    text: "Saturday hours: 10am to 4pm.",
    phones: ["+1 212 555 0199"],
    emails: ["late@business.example"],
  };
  const discovery: Discovery = {
    inputUrl: "https://business.example",
    origin: "https://business.example",
    pages,
    skipped: [],
    warnings: [],
    complete: true,
    discovered: MAX_CRAWL_PAGES,
    crawledAt: new Date().toISOString(),
  };
  assert.ok(discoverySchema.safeParse(discovery).success);
  assert.equal(
    discoverySchema.safeParse({ ...discovery, pages: [...pages, page] })
      .success,
    false,
  );
  const packet = knowledgePacket(brief, discovery);
  assert.ok(packet.length < 300000);
  assert.ok(
    packet.includes("late@business.example") &&
      packet.includes("Saturday hours: 10am to 4pm"),
  );
  const parsed = JSON.parse(packet);
  assert.equal(parsed.sourceWebsite.coverage.read, 2000);
  assert.ok(parsed.sourceWebsite.pages.length <= 80);
  assert.ok(parsed.sourceWebsite.contextCoverage.notes.length);
  const old = process.env.CRAWL_MAX_PAGES;
  try {
    process.env.CRAWL_MAX_PAGES = "999999";
    assert.equal(crawlSettings().maxPages, 2000);
  } finally {
    if (old === undefined) delete process.env.CRAWL_MAX_PAGES;
    else process.env.CRAWL_MAX_PAGES = old;
  }
});
