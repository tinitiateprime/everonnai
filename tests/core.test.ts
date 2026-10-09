import test from "node:test";
import assert from "node:assert/strict";
import {
  knowledgeSchema,
  knowledgeDraftSchema,
  emptyKnowledge,
} from "../lib/types";
import { isPublicIp, parsePublicUrl, safeResource } from "../lib/network";
import { extractPage } from "../lib/extract";
import { discoverWebsite, crawlable } from "../lib/crawler";
import { eligibleWebsiteModels } from "../lib/openrouter";
import { load } from "cheerio";
import {
  validateWebsite,
  PREVIEW_CSP,
  stripImageCaptions,
} from "../lib/validation";
import { knowledgePacket } from "../lib/prompts";
import { brief, website, model } from "./fixtures";

test("name, type and description are required; other details and service rows remain optional", () => {
  const minimal = {
    businessName: "Local Bakery",
    businessType: "Bakery",
    description: "A community bakery.",
  };
  assert.equal(knowledgeSchema.parse(minimal).phone, "");
  for (const field of ["businessName", "businessType", "description"])
    assert.equal(
      knowledgeSchema.safeParse({ ...minimal, [field]: " " }).success,
      false,
    );
  assert.equal(
    knowledgeDraftSchema.safeParse({
      ...emptyKnowledge,
      description: "An incomplete draft.",
      email: "unfinished@",
    }).success,
    true,
  );
  assert.equal(
    knowledgeSchema.parse({
      ...emptyKnowledge,
      businessName: "Bakery",
      businessType: "Bakery",
      description: "Bakery",
      services: [{ name: "", description: "" }],
    }).services.length,
    1,
  );
  assert.equal(
    knowledgeSchema.safeParse({ ...emptyKnowledge, description: " " }).success,
    false,
  );
  assert.equal(
    knowledgeSchema.safeParse({
      ...emptyKnowledge,
      description: "Bakery",
      email: "not-an-email",
    }).success,
    false,
  );
});
test("public network guard rejects private, mapped, reserved and credential URLs", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "0.0.0.0",
    "224.0.0.1",
  ])
    assert.equal(isPublicIp(ip), false, ip);
  assert.equal(isPublicIp("8.8.8.8"), true);
  for (const url of [
    "http://127.0.0.1/",
    "http://localhost/",
    "http://[::1]/",
    "file:///etc/passwd",
    "https://user:pass@business.example/",
    "http://business.example:8080/",
    "http://2130706433/",
  ])
    assert.throws(() => parsePublicUrl(url), url);
  await assert.rejects(
    safeResource("http://169.254.169.254/latest/meta-data"),
    /Private|local/,
  );
});
test("HTML extraction keeps contacts, metadata, resolved assets and design cues", () => {
  const page = extractPage(
    `<html><head><title>Our studio</title><meta name="description" content="Careful work"><style>body{color:#112233;font-family:Georgia}</style><script type="application/ld+json">{"@type":"LocalBusiness","name":"Northline"}</script></head><body><h1>Heating</h1><p>Phone: +1 212 555 0124. Email hello@northline.example</p><a href="/services">Services</a><a href="mailto:hello@northline.example">Email</a><img src="/team.jpg" alt="Our team"></body></html>`,
    "https://business.example/",
  );
  assert.equal(page.title, "Our studio");
  assert.ok(page.emails.includes("hello@northline.example"));
  assert.ok(page.links.includes("https://business.example/services"));
  assert.equal(page.images[0].url, "https://business.example/team.jpg");
  assert.ok(page.design.colors.includes("#112233"));
  assert.ok(page.design.fonts.includes("Georgia"));
  assert.equal(page.structuredData.length, 1);
  assert.ok(!page.text.includes("@type"));
});
test("crawler follows sitemaps/internal pages, respects robots and reports failures", async () => {
  const origin = "https://business.example";
  const documents: Record<
    string,
    { body: string; type?: string; status?: number }
  > = {
    "/": {
      body: '<html><head><title>Business</title></head><body><h1>Business</h1><a href="/contact">Contact</a><a href="/private">Private</a><a href="https://other.example/services">External</a><a href="/broken">Broken</a></body></html>',
    },
    "/robots.txt": {
      type: "text/plain",
      body: `User-agent: *\nDisallow: /private\nSitemap: ${origin}/sitemap.xml`,
    },
    "/sitemap.xml": {
      type: "application/xml",
      body: `<urlset><url><loc>${origin}/about</loc></url></urlset>`,
    },
    "/about": {
      body: "<html><head><title>About</title></head><body><h1>About us</h1><p>Heating and cooling.</p></body></html>",
    },
    "/contact": {
      body: '<html><head><title>Contact</title></head><body><h1>Contact</h1><a href="tel:+12125550124">Call</a></body></html>',
    },
  };
  const fetched: string[] = [];
  const discovery = await discoverWebsite(origin, () => {}, undefined, {
    browser: null,
    resource: async (url) => {
      fetched.push(url);
      const entry = documents[new URL(url).pathname];
      return {
        url,
        status: entry?.status ?? (entry ? 200 : 404),
        headers: { "content-type": entry?.type ?? "text/html" },
        body: Buffer.from(entry?.body ?? "Not found"),
      };
    },
  });
  assert.equal(discovery.pages.length, 3);
  assert.ok(discovery.pages.some((p) => p.title === "About"));
  assert.ok(discovery.skipped.some((p) => p.reason.includes("robots")));
  assert.ok(discovery.skipped.some((p) => p.url.endsWith("/broken")));
  assert.ok(
    !fetched.some((u) => u.endsWith("/private") || u.includes("other.example")),
  );
  assert.equal(discovery.complete, false);
  const packet = JSON.parse(knowledgePacket(brief, discovery));
  assert.equal(packet.sourceWebsite.pages.length, 3);
  assert.equal(packet.ownerKnowledge.phone, brief.phone);
});
test("crawl URL normalization removes trackers and excludes actions/off-site URLs", () => {
  assert.equal(
    crawlable(
      "https://business.example/about/?utm_source=x#team",
      "https://business.example",
    ),
    "https://business.example/about",
  );
  for (const path of ["/checkout", "/logout", "/manual.pdf", "/?search=x"])
    assert.equal(
      crawlable(`https://business.example${path}`, "https://business.example"),
      null,
    );
});
test("adjacent contact links stay separated and JSON-LD contact data is captured", () => {
  const page = extractPage(
    `<html><head><script type="application/ld+json">{"@type":"LocalBusiness","telephone":"+442012345678","email":"help@studio.example","openingHours":"Mo-Fr 09:00-18:00"}</script></head><body><a href="tel:+12125550124">+1 212 555 0124</a><a href="mailto:hello@studio.example">hello@studio.example</a></body></html>`,
    "https://studio.example/",
  );
  assert.ok(page.emails.includes("help@studio.example"));
  assert.ok(page.emails.includes("hello@studio.example"));
  assert.ok(!page.emails.some((e) => e.startsWith("0124")));
  assert.ok(page.phones.includes("+442012345678"));
});
test("suitable text models qualify at any price and safety-only models are excluded", () => {
  const selected = eligibleWebsiteModels([
    model,
    {
      ...model,
      id: "test/paid",
      pricing: { prompt: "0.1", completion: "0.1" },
    },
    { ...model, id: "test/content-safety:free" },
    { ...model, id: "test/small:free", context_length: 4096 },
  ]);
  assert.deepEqual(
    selected.map((m) => m.id),
    [model.id, "test/paid"],
  );
});
test("website validation preserves original design and injects CSP", () => {
  const validated = validateWebsite(website(), brief);
  assert.ok(validated.html.includes(PREVIEW_CSP));
  assert.ok(validated.html.includes("comfort at home"));
  assert.ok(validated.html.includes("AC installation"));
  assert.throws(
    () => validateWebsite(website(), brief, [validated.html]),
    /duplicates/,
  );
});
test("website validator allows scroll-behavior but rejects legacy CSS behaviors", () => {
  const withStyle = (rule: string) =>
    website().replace("</style>", `${rule}</style>`);
  assert.doesNotThrow(() =>
    validateWebsite(withStyle("html{scroll-behavior:smooth}"), brief),
  );
  assert.doesNotThrow(() =>
    validateWebsite(withStyle("main{overscroll-behavior: contain}"), brief),
  );
  assert.throws(
    () => validateWebsite(withStyle("main{behavior:url(x.htc)}"), brief),
    /Unsafe CSS/,
  );
});
test("website validator drops Google Fonts preconnect hints instead of rejecting", () => {
  const html = website().replace(
    "</head>",
    '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin></head>',
  );
  const validated = validateWebsite(html, brief);
  assert.ok(!validated.html.includes("preconnect"));
  assert.throws(
    () =>
      validateWebsite(
        website().replace(
          "</head>",
          '<link rel="preconnect" href="https://tracker.example"></head>',
        ),
        brief,
      ),
    /Google Fonts/,
  );
});
test("image captions are removed but linked photo credits stay", () => {
  const html = website().replace(
    "</main>",
    '<div class="visual"><figure><img src="https://images.pexels.com/photos/1/a.jpeg" alt="Tea"></figure><span class="photo-note">LEAF → WATER → A LITTLE PAUSE</span></div><figure><img src="https://images.pexels.com/photos/1/a.jpeg" alt="Tea"><figcaption>Catalogue specimen No. 01</figcaption></figure><figure><img src="https://images.pexels.com/photos/1/a.jpeg" alt="Tea"><figcaption>Photo by <a href="https://www.pexels.com/@ana">Ana</a></figcaption></figure></main>',
  );
  const $ = load(html);
  stripImageCaptions($);
  const out = $.html();
  assert.ok(!out.includes("A LITTLE PAUSE"));
  assert.ok(!out.includes("specimen"));
  assert.ok(out.includes("Photo by"));
  assert.ok(out.includes("Speak with our team"));
});
test("website validator rejects executable content, invented contacts, lost services and dead anchors", () => {
  for (const changed of [
    website().replace("</body>", "<script>alert(1)</script></body>"),
    website().replace('href="#services"', 'href="#missing"'),
    website().replace("AC installation", "Other service"),
    website().replace(
      'href="mailto:hello@northline.example"',
      'href="mailto:fake@invented.example"',
    ),
    website().replace("<main>", '<main onclick="alert(1)">'),
    website().replace("</main>", '<img src="http://127.0.0.1/private"></main>'),
  ])
    assert.throws(() => validateWebsite(changed, brief));
});
