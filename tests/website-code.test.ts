import test from "node:test";
import assert from "node:assert/strict";
import { createDemoWorkspace } from "@/features/everonn/demo-data";
import { generateDeterministicWebsiteSpec } from "./fixtures/website";
import { websiteCodeFixture } from "./fixtures/website-code";
import { normalizeWebsiteCodeConcept, prepareWebsitePage, scopeWebsiteCss, validateWebsiteCss } from "@/features/website-studio/code-validation";
import { generateWebsiteCode } from "@/features/website-studio/code-generator";
import { createWebsiteProject, runWebsiteQa } from "@/features/website-studio/generator";
import { publishWebsiteRevision, rollbackWebsiteRelease } from "@/features/website-studio/releases";
import { liveWebsite, websiteAccess } from "@/features/website-studio/site-access";
import { EMPTY_WEBSITE_PREFERENCES } from "@/features/agent-runtime/memory";

const workspace = () => createDemoWorkspace();
const config = { apiKey: "fixture-only", models: ["fixture-model"], timeoutMs: 10000, retryDelayMs: 0 };

test("code grounding checks rendered text, accessible labels and CSS content without treating selectors as copy", () => {
  const { profile } = workspace();
  const spec = generateDeterministicWebsiteSpec(profile);
  const concept = websiteCodeFixture(spec, profile);
  concept.rationale = "No placeholder copy or unsupported certified claims.";
  concept.css += ".placeholder, .certified { display:block }";
  concept.pages[0].html += '<div class="placeholder certified"></div>';
  spec.code = { schemaVersion: 1, concepts: { editorial: concept, momentum: concept, aura: concept }, validatedAt: new Date().toISOString() };
  assert.equal(runWebsiteQa(spec, profile).passed, true);
  for (const html of ['<p>Certified inspections</p>', '<img alt="Certified inspectors">', '<a aria-label="Certified inspections">Contact</a>']) {
    const modified = structuredClone(spec);
    modified.code!.concepts.editorial.pages[0].html += html;
    assert.equal(runWebsiteQa(modified, profile).checks.find((check) => check.key === "no-unsupported-claims")?.passed, false);
  }
  concept.css += '.site::before { --badge:"Certified inspectors"; content:var(--badge) }';
  assert.equal(runWebsiteQa(spec, profile).checks.find((check) => check.key === "no-unsupported-claims")?.passed, false);
});

test("real website code accepts original layouts and rewrites routes without a layout enum", () => {
  const { profile } = workspace();
  const spec = generateDeterministicWebsiteSpec(profile);
  const result = normalizeWebsiteCodeConcept(websiteCodeFixture(spec, profile), spec, profile);
  assert.equal(result.pages.length, spec.services.length + 4);
  const prepared = prepareWebsitePage(result.pages[0], result.css, spec, profile, "editorial", "/preview/private-capability", true);
  assert.match(prepared.html, /href="\/preview\/private-capability\/services\?theme=editorial"/);
  assert.match(prepared.html, /data-everonn-action="booking"/);
  assert.match(prepared.css, /#everonn-generated-site \.home-content/);
  assert.doesNotMatch(prepared.html, /hero-layout-|services-layout-/);
});

test("HTML parser rejects execution, forged contacts, unsupported routes and broken page coverage", () => {
  const { profile } = workspace();
  const spec = generateDeterministicWebsiteSpec(profile);
  const valid = websiteCodeFixture(spec, profile);
  for (const injection of ['<script>alert(1)</script>', '<img src="asset:hero" onerror="alert(1)">', '<iframe src="https://example.com"></iframe>', '<svg><a href="javascript:alert(1)">x</a></svg>', '<form action="/api/workspace"></form>', '<a href="jav&#x61;script:alert(1)">Click</a>', '<a href="tel:+19999999999">Call</a>', '<a href="/services/not-offered">Extra</a>', '<a href="#missing">Broken</a>', '<img src="https://tracker.example/pixel" alt="">']) {
    const fixture = structuredClone(valid);
    fixture.pages[0].html += injection;
    assert.throws(() => normalizeWebsiteCodeConcept(fixture, spec, profile), /Website code validation/);
  }
  const missing = structuredClone(valid);
  missing.pages.pop();
  assert.throws(() => normalizeWebsiteCodeConcept(missing, spec, profile), /every required page/);
  const duplicate = structuredClone(valid);
  duplicate.pages[1].path = duplicate.pages[0].path;
  assert.throws(() => normalizeWebsiteCodeConcept(duplicate, spec, profile), /duplicate/);
});

test("page repair feedback identifies the route and every missing structural requirement", () => {
  const { profile } = workspace();
  const spec = generateDeterministicWebsiteSpec(profile);
  const fixture = websiteCodeFixture(spec, profile);
  const page = fixture.pages.find((item) => item.path === "/about")!;
  page.html = page.html.replace(/<(\/?)(main|nav|h1)\b/g, "<$1div").replace(/href="action:(booking|chat|voice)"/g, 'href="/contact"');
  assert.throws(() => normalizeWebsiteCodeConcept(fixture, spec, profile), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /Page \/about:/);
    assert.match(error.message, /one <main> element; found 0/);
    assert.match(error.message, /one <h1> element; found 0/);
    assert.match(error.message, /<nav> element/);
    assert.match(error.message, /href="action:booking"/);
    return true;
  });
});

test("CSS parser blocks resource requests and prefixes every selector including sibling selectors", () => {
  const { profile } = workspace();
  const spec = generateDeterministicWebsiteSpec(profile);
  const css = websiteCodeFixture(spec, profile).css;
  for (const addition of ['@import "https://example.com/x.css";', '.site{background:url(https://example.com/x)}', '.site{background:u\\72l(https://example.com/x)}', '.site{background:image-set("https://example.com/x" 1x)}', '.site{behavior:url(x)}', '</style><script>alert(1)</script>', '@font-face{font-family:x;src:url(x)}']) assert.throws(() => validateWebsiteCss(css + addition));
  const scoped = scopeWebsiteCss(css + 'body + .client-assistant, #everonn-generated-site + dialog {display:none} @keyframes appear {from{opacity:0}to{opacity:1}} .intro{animation:appear 1s}', "aura");
  assert.match(scoped, /#everonn-generated-site \.site\+\.client-assistant/);
  assert.match(scoped, /#everonn-generated-site #everonn-generated-site\+dialog/);
  assert.match(scoped, /@keyframes everonn-aura-appear/);
  assert.match(scoped, /animation:everonn-aura-appear/);
});

test("approved assets, hidden sections and service priority constrain code without imposing layouts", () => {
  const { profile } = workspace();
  const spec = generateDeterministicWebsiteSpec(profile);
  const fixture = websiteCodeFixture(spec, profile);
  spec.media.hero = { id: "real", url: "https://images.pexels.com/photos/123/example.jpeg", alt: "HVAC equipment", photographer: "Example", sourceUrl: "https://www.pexels.com/photo/123/" };
  fixture.pages[0].html += '<img src="asset:hero" alt="HVAC equipment">';
  const result = normalizeWebsiteCodeConcept(fixture, spec, profile);
  assert.match(prepareWebsitePage(result.pages[0], result.css, spec, profile, "editorial", "/sites/hvac", false).html, /images.pexels.com/);
  assert.throws(() => normalizeWebsiteCodeConcept(fixture, spec, profile, { ...EMPTY_WEBSITE_PREFERENCES, imagery: "none" }), /approved asset/);
  fixture.pages[0].html += '<section data-section="gallery">Gallery</section>';
  assert.throws(() => normalizeWebsiteCodeConcept(fixture, spec, profile, { ...EMPTY_WEBSITE_PREFERENCES, hiddenSections: ["gallery"] }), /owner-hidden/);
  assert.throws(() => normalizeWebsiteCodeConcept(websiteCodeFixture(spec, profile), spec, profile, { ...EMPTY_WEBSITE_PREFERENCES, priorityServiceId: profile.services[1].id }), /priority service/);
});

test("Gemini creates three code artifacts with bounded validation repair and no template fallback", async () => {
  const { profile } = workspace();
  const spec = generateDeterministicWebsiteSpec(profile);
  const attempts = new Map<string, number>();
  const result = await generateWebsiteCode(spec, profile, { config, fetchImpl: (async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const prompt = body.contents[0].parts[0].text;
    const concept = prompt.match(/Create the (editorial|momentum|aura) design/)[1] as "editorial" | "momentum" | "aura";
    const requested = body.generationConfig.responseSchema.properties.pages.items.properties.path.enum as string[];
    if (requested.includes("/")) attempts.set(concept, (attempts.get(concept) || 0) + 1);
    const output = websiteCodeFixture(spec, profile, concept);
    output.pages = output.pages.filter((page) => requested.includes(page.path));
    if (concept === "editorial" && requested.includes("/") && attempts.get(concept) === 1) output.pages[0].html += '<script>alert(1)</script>';
    assert.match(body.systemInstruction.parts[0].text, /actual semantic HTML/);
    assert.doesNotMatch(JSON.stringify(body.generationConfig.responseSchema), /split|immersive|centered/);
    assert.ok(requested.length <= 3);
    assert.ok(requested.every((path) => path === "/" || path === "/services" || path === "/about" || path === "/contact" || spec.services.some((service) => path === `/services/${service.slug}`)));
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(output) }] } }] });
  }) as typeof fetch });
  assert.equal(attempts.get("editorial"), 2);
  assert.equal(attempts.get("momentum"), 1);
  assert.ok(result.concepts.aura.css);
  await assert.rejects(generateWebsiteCode(spec, profile, { config, fetchImpl: (async () => Response.json({ error: { message: "offline" } }, { status: 503 })) as typeof fetch }), /HTTP 503/);
});

test("a single repair receives route errors across pages and benign inline styles become CSS", async () => {
  const { profile } = workspace();
  const spec = generateDeterministicWebsiteSpec(profile);
  let repairs = 0;
  await generateWebsiteCode(spec, profile, { config, fetchImpl: (async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const label = body.contents[0].parts[0].text.match(/Create the (editorial|momentum|aura) design/)[1] as "editorial" | "momentum" | "aura";
    const requested = body.generationConfig.responseSchema.properties.pages.items.properties.path.enum as string[];
    const output = websiteCodeFixture(spec, profile, label);
    output.pages = output.pages.filter((page) => requested.includes(page.path));
    if (label === "editorial" && requested[0] === "/services" && body.contents.length === 1) {
      output.pages[0].path = "/services/index.html";
      output.pages[1].html += '<p style="margin:10px">Move into stylesheet</p>';
      output.pages[2].html += '<a href="/contact/index.html">Contact</a>';
      output.pages[1].html += '<p>Certified inspections</p>';
    } else if (label === "editorial" && body.contents.length > 1) {
      repairs++;
      const feedback = body.contents[2].parts[0].text;
      assert.match(feedback, /Page 1 must use an exact requested route/);
      assert.match(feedback, /ALL .html links on page 3/);
      assert.match(feedback, /Remove unsupported claims: Certified/);
    }
    return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(output) }] } }] });
  }) as typeof fetch });
  assert.equal(repairs, 1);
});

test("inline declarations are converted into guarded stylesheet rules before rendering", () => {
  const { profile } = workspace();
  const spec = generateDeterministicWebsiteSpec(profile);
  const fixture = websiteCodeFixture(spec, profile);
  fixture.pages[0].html += '<p style="margin-top:24px;color:var(--brand-primary)">Business-specific design detail.</p>';
  const normalized = normalizeWebsiteCodeConcept(fixture, spec, profile);
  assert.doesNotMatch(normalized.pages[0].html, /style=/);
  assert.match(normalized.css, /everonn-declaration-0-0\{margin-top:24px;color:var\(--brand-primary\)\}/);
  for (const value of ['background:url(https://tracker.example/x)', 'background:u\\72l(https://tracker.example/x)', 'background:image-set(&quot;https://tracker.example/x&quot; 1x)', 'color:red}@import &quot;https://tracker.example/x&quot;', '--asset:url(https://tracker.example/x)']) {
    const unsafe = structuredClone(fixture);
    unsafe.pages[0].html += `<p style="${value}">Unsafe</p>`;
    assert.throws(() => normalizeWebsiteCodeConcept(unsafe, spec, profile));
  }
  const document = structuredClone(fixture);
  document.pages[0].html = `<html><body>${document.pages[0].html}</body></html>`;
  assert.throws(() => normalizeWebsiteCodeConcept(document, spec, profile), /body fragment/);
});

test("service pages can use their approved headline without repeating the literal service label", () => {
  const { profile } = workspace();
  const spec = generateDeterministicWebsiteSpec(profile);
  const service = spec.services[0];
  service.pageHeadline = "Repair guidance for your heating and cooling system.";
  const fixture = websiteCodeFixture(spec, profile);
  const detail = fixture.pages.find((page) => page.path === `/services/${service.slug}`)!;
  detail.html = detail.html.replaceAll(service.name, service.pageHeadline).replaceAll(service.name.toLowerCase(), service.pageHeadline);
  assert.ok(normalizeWebsiteCodeConcept(fixture, spec, profile));
  detail.html = detail.html.replaceAll(service.pageHeadline, "A completely unrelated service.");
  assert.throws(() => normalizeWebsiteCodeConcept(fixture, spec, profile), /identify the active service/);
});

test("publishing snapshots facts, preserves live pages during regeneration and supports scoped rollback", () => {
  let state = workspace();
  const spec = generateDeterministicWebsiteSpec(state.profile);
  spec.code = { schemaVersion: 1, validatedAt: new Date().toISOString(), concepts: { editorial: websiteCodeFixture(spec, state.profile, "editorial"), momentum: websiteCodeFixture(spec, state.profile, "momentum"), aura: websiteCodeFixture(spec, state.profile, "aura") } };
  const first = { ...createWebsiteProject(state.profile, spec), status: "approved" as const, selectedConcept: "editorial" as const, profileSnapshot: structuredClone(state.profile) };
  state = publishWebsiteRevision(state, first);
  const original = state.publishedWebsite!;
  state.websiteProject = { ...createWebsiteProject(state.profile, structuredClone(spec)), publicSlug: first.publicSlug };
  assert.equal(liveWebsite(state)?.id, first.id);
  assert.equal(websiteAccess(state, { publicSlug: first.publicSlug })?.id, first.id);
  assert.equal(websiteAccess(state, { publicSlug: "another-company" }), null);
  assert.equal(websiteAccess(state, { previewToken: state.websiteProject.privateToken })?.id, state.websiteProject.id);
  const next = { ...state.websiteProject, status: "approved" as const, selectedConcept: "aura" as const };
  state = publishWebsiteRevision(state, next);
  assert.equal(state.websiteReleases?.[0].id, original.id);
  state = rollbackWebsiteRelease(state, original.id);
  assert.equal(liveWebsite(state)?.id, first.id);
  assert.equal(state.websiteProject?.id, next.id);
  assert.throws(() => rollbackWebsiteRelease(state, "outside-tenant"), /unavailable/);
  state.profile.description += " Updated business facts.";
  assert.throws(() => publishWebsiteRevision(state, first), /Business facts changed/);
  assert.throws(() => publishWebsiteRevision(state, { ...next, workspaceId: "another-company" }), /Approve/);
});

test("large catalogues use small batches and a timed-out batch retries without rebuilding completed pages", async () => {
  const { profile } = workspace();
  const service = profile.services[0];
  profile.services = Array.from({ length: 13 }, (_, index) => ({ ...service, id: `service_${index}`, name: `Climate service ${index + 1}` }));
  const spec = generateDeterministicWebsiteSpec(profile);
  let active = 0, maximumActive = 0, timedOut = false;
  const calls: Array<{ concept: string; paths: string[]; model: string }> = [];
  const progress: number[] = [];
  const result = await generateWebsiteCode(spec, profile, {
    config: { ...config, models: ["primary", "backup"] },
    onProgress: (event) => { if (event.completedPages !== undefined) progress.push(event.completedPages); },
    fetchImpl: (async (url, init) => {
      const body = JSON.parse(String(init?.body));
      const concept = body.contents[0].parts[0].text.match(/Create the (editorial|momentum|aura) design/)[1] as "editorial" | "momentum" | "aura";
      const paths = body.generationConfig.responseSchema.properties.pages.items.properties.path.enum as string[];
      const model = new URL(String(url)).pathname.match(/models\/([^:]+)/)![1];
      calls.push({ concept, paths, model });
      active++; maximumActive = Math.max(active, maximumActive);
      try {
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (concept === "editorial" && paths.includes(`/services/${spec.services[3].slug}`) && !timedOut) {
          timedOut = true;
          throw new DOMException("The operation timed out", "TimeoutError");
        }
        const output = websiteCodeFixture(spec, profile, concept);
        output.pages = output.pages.filter((page) => paths.includes(page.path));
        return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(output) }] } }] });
      } finally { active--; }
    }) as typeof fetch,
  });
  assert.equal(timedOut, true);
  assert.ok(maximumActive <= 3);
  assert.ok(calls.every((call) => call.paths.length <= 3));
  assert.equal(calls.filter((call) => call.paths.includes("/")).length, 3);
  assert.deepEqual(result.concepts.editorial.models, ["primary", "backup"]);
  for (const concept of Object.values(result.concepts)) {
    assert.equal(concept.pages.length, 17);
    assert.equal(new Set(concept.pages.map((page) => page.path)).size, 17);
  }
  assert.equal(progress.at(-1), 51);
  assert.ok(progress.every((count, index) => index === 0 || count >= progress[index - 1]));
});

test("exhausted code timeouts identify the failed concept and routes", async () => {
  const { profile } = workspace();
  const spec = generateDeterministicWebsiteSpec(profile);
  await assert.rejects(generateWebsiteCode(spec, profile, {
    config,
    fetchImpl: (async () => { throw new DOMException("The operation timed out", "TimeoutError"); }) as typeof fetch,
  }), /building editorial: \/.*AI response exceeded/);
});
