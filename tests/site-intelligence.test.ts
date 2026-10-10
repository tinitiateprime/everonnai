import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { embeddedDatabase } from "../lib/platform/database";
import { migrateDatabase } from "../lib/platform/migrations";
import { createSession } from "../lib/auth/sessions";
import {
  createProject,
  createTenant,
  projectTransaction,
} from "../lib/projects/service";
import { LocalObjectStore } from "../lib/storage/artifacts";
import {
  startScan,
  runScanBatch,
  freezeSnapshot,
} from "../lib/discovery/service";
import {
  startIntelligence,
  runIntelligenceBatch,
  intelligenceReport,
  intelligenceDetail,
  pageAssessment,
  screenshotResponse,
} from "../lib/intelligence/service";
import { inspectHtml } from "../lib/intelligence/extract";
import { platformRequest } from "../lib/platform/http";
import type { safeResource } from "../lib/network";
const origin = "https://site-intelligence.example.com";
function html(route: string) {
  return `<!doctype html><html><head><title>${route === "/contact" ? "Contact studio" : "Studio services"}</title><link rel="stylesheet" href="/site.css"><script src="/site.js" defer></script><script type="application/ld+json">{"@context":"https://schema.org","@type":"LocalBusiness","name":"Source studio","address":{"streetAddress":"7 Main Street"},"priceRange":"$100"}</script></head><body><header><a href="/">Source studio</a><nav><a href="/about">About</a><a href="/contact">Contact</a><a href="/broken">Missing page</a><a href="/contact#missing-section">Fragment</a></nav></header><main><section class="wide"><h1>${route === "/contact" ? "Contact" : "Studio services"}</h1><p>Owner services cost $100. Full captured business evidence.</p><img src="/missing-image.png"><details><summary>Frequently asked question</summary><p>Source answer preserved in the inventory.</p></details></section><section><h2>Enquire</h2><form action="/send" method="POST" aria-label="Enquiry"><input type="email" name="email" required><label>Message<textarea name="message"></textarea></label><button>Send enquiry</button></form></section><iframe title="Appointment booking" src="https://calendly.com/source-studio"></iframe><address>7 Main Street</address><a href="mailto:owner@example.com">Email us</a></main><footer>Source studio</footer></body></html>`;
}
test("public-site intelligence persists all page assessments and produces an evidence-linked report with honest gaps", async (t) => {
  const dir = await mkdtemp(
      path.join(os.tmpdir(), "everonn-intelligence-test-"),
    ),
    db = await embeddedDatabase(),
    store = new LocalObjectStore(path.join(dir, "objects"));
  const original = { ...process.env };
  Object.assign(process.env, {
    NODE_ENV: "test",
    PLATFORM_LOCAL_MODE: "1",
    AUTH_BASE_URL: "http://localhost:3000",
  });
  t.after(async () => {
    await db.close();
    for (const key of Object.keys(process.env))
      if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith("everonn-intelligence-test-"));
    await rm(dir, { recursive: true, force: true });
  });
  assert.equal(await migrateDatabase(db), 5);
  const owner = await createSession(db, {
      issuer: "urn:intelligence",
      subject: "owner",
      displayName: "Owner",
    }),
    other = await createSession(db, {
      issuer: "urn:intelligence",
      subject: "other",
      displayName: "Other",
    });
  const tenant = await createTenant(db, owner.user, "Audit workspace"),
    project = await createProject(db, owner.user, tenant.id, {
      name: "Audit business",
      sourceUrl: origin,
    });
  const otherTenant = await createTenant(db, other.user, "Other"),
    otherProject = await createProject(db, other.user, otherTenant.id, {
      name: "Other",
    });
  const requests: string[] = [];
  const resource: typeof safeResource = async (value, options) => {
    options?.signal?.throwIfAborted();
    requests.push(new URL(value).pathname);
    const route = new URL(value).pathname;
    let status = 200,
      contentType = "text/html",
      body = "";
    if (route === "/robots.txt") {
      contentType = "text/plain";
      body = "User-agent: *\nAllow: /\n";
    } else if (
      route.includes("sitemap") ||
      route === "/broken" ||
      route === "/missing-image.png"
    ) {
      status = 404;
      body = "missing";
    } else if (route === "/site.css") {
      contentType = "text/css";
      body =
        ":root{--brand:#175f51}body{font-family:Georgia,serif;color:#333}.wide{width:1800px;padding:24px;border-radius:12px}nav{display:flex;gap:16px}@media(max-width:700px){h1{font-size:32px}}";
    } else if (route === "/site.js") {
      contentType = "application/javascript";
      body =
        "fetch('/send',{method:'POST',body:'Do not send this'}).catch(()=>{});const p=document.createElement('p');p.textContent='Browser-only content';document.querySelector('main').append(p);";
    } else body = html(route);
    return {
      url: value,
      status,
      headers: { "content-type": contentType },
      body: Buffer.from(body),
    };
  };
  const discovery = {
    resource,
    browser: null,
    evidenceMode: "fixture" as const,
    settings: { maxPages: 20, batchPages: 20, batchMs: 10000, concurrency: 2 },
  };
  const scan = await startScan(
    db,
    owner.user,
    project.id,
    randomUUID(),
    discovery,
  );
  await runScanBatch(
    db,
    store,
    owner.user,
    project.id,
    scan.id,
    {},
    undefined,
    discovery,
  );
  await assert.rejects(
    freezeSnapshot(db, store, owner.user, project.id, scan.id),
    /incomplete coverage/,
  );
  const snapshot = await freezeSnapshot(
      db,
      store,
      owner.user,
      project.id,
      scan.id,
      true,
    ),
    runtime = {
      resource,
      mode: "fixture" as const,
      advice: "disabled" as const,
    };
  const input = { snapshotId: snapshot.id, requestKey: randomUUID() },
    created = await startIntelligence(
      db,
      store,
      owner.user,
      project.id,
      input,
      runtime,
    );
  assert.equal(created.requiredPages, 3);
  assert.equal(
    (await startIntelligence(db, store, owner.user, project.id, input, runtime))
      .id,
    created.id,
  );
  let run = await runIntelligenceBatch(
    db,
    store,
    owner.user,
    project.id,
    created.id,
    undefined,
    runtime,
  );
  assert.equal(run.processedPages, 2);
  assert.equal(run.status, "paused");
  await projectTransaction(db, owner.user, project.id, true, (client) =>
    client.query(
      "UPDATE everonn_platform.intelligence_runs SET status='running',lease_expires_at=clock_timestamp()+interval '240 seconds' WHERE id=$1",
      [run.id],
    ),
  );
  await assert.rejects(
    runIntelligenceBatch(
      db,
      store,
      owner.user,
      project.id,
      run.id,
      undefined,
      runtime,
    ),
    /already running/,
  );
  await projectTransaction(db, owner.user, project.id, true, (client) =>
    client.query(
      "UPDATE everonn_platform.intelligence_runs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [run.id],
    ),
  );
  run = await runIntelligenceBatch(
    db,
    store,
    owner.user,
    project.id,
    run.id,
    undefined,
    runtime,
  );
  assert.equal(run.processedPages, 3);
  assert.equal(run.stage, 1);
  run = await runIntelligenceBatch(
    db,
    store,
    owner.user,
    project.id,
    run.id,
    undefined,
    runtime,
  );
  assert.equal(run.status, "partial");
  assert.equal(run.stage, 2);
  assert.equal(run.browserPages, 3);
  const { report } = await intelligenceReport(
    db,
    store,
    owner.user,
    project.id,
    run.id,
  );
  assert.equal(report.pages.length, 3);
  assert.equal(report.coverage.assessed, 3);
  assert.equal(report.coverage.browserAssessed, 3);
  assert.equal(report.mode, "fixture");
  assert.ok(
    report.coverage.assessmentGaps.some((gap) => gap.includes("/broken")),
  );
  for (const rule of [
    "missing_description",
    "missing_language",
    "missing_viewport",
    "broken_internal_link",
    "missing_anchor",
    "viewport_overflow",
    "feature_contract",
    "failed_resource",
  ])
    assert.ok(
      report.findings.some((finding) => finding.rule === rule),
      rule,
    );
  assert.ok(
    report.findings.some((finding) => finding.rule.startsWith("axe:")),
    "Real axe findings should be recorded",
  );
  const referenceIds = new Set(
    report.references.map((reference) => reference.id),
  );
  assert.ok(
    report.findings.every(
      (finding) =>
        finding.evidenceIds.length > 0 &&
        finding.evidenceIds.every((id) => referenceIds.has(id)),
    ),
  );
  assert.ok(
    report.features.some(
      (feature) =>
        feature.kind === "enquiry" && feature.backend === "not_tested",
    ),
  );
  assert.ok(
    report.features.some(
      (feature) =>
        feature.kind === "booking" && feature.backend === "not_tested",
    ),
  );
  assert.ok(
    report.designSystem.tokens.some(
      (token) => token.kind === "font" && token.value.includes("Georgia"),
    ),
  );
  assert.ok(
    report.designSystem.tokens.some(
      (token) => token.kind === "custom_property" && token.name === "--brand",
    ),
  );
  assert.ok(
    report.actionPlan.every(
      (action) => action.findingIds.length && action.acceptance.length,
    ),
  );
  assert.equal(report.advice.status, "not_configured");
  assert.equal(
    requests.includes("/send"),
    false,
    "Source submissions must be blocked before network access",
  );
  const page = await pageAssessment(
    db,
    store,
    owner.user,
    project.id,
    run.id,
    report.pages[0].captureId,
  );
  assert.equal(page.browser.viewports.length, 3);
  assert.ok(
    page.browser.interactions.some(
      (interaction) => interaction.outcome === "revealed",
    ),
  );
  assert.ok(
    page.renderedInventory?.sections.some((section) =>
      section.text.includes("Browser-only content"),
    ),
  );
  assert.ok(page.inventory.businessData.prices.includes("$100"));
  assert.ok(
    page.inventory.businessData.structuredFacts.some(
      (fact) => fact.path.endsWith(".name") && fact.value === "Source studio",
    ),
  );
  assert.equal(
    (
      await screenshotResponse(
        db,
        store,
        owner.user,
        project.id,
        run.id,
        page.captureId,
        390,
      )
    ).headers.get("content-type"),
    "image/png",
  );
  await assert.rejects(
    intelligenceReport(db, store, other.user, otherProject.id, run.id),
    /do not have access/,
  );
  await assert.rejects(
    db.transaction((client) =>
      client.query(
        "UPDATE everonn_platform.intelligence_runs SET status='queued' WHERE id=$1",
        [run.id],
      ),
    ),
    /immutable/,
  );
  await assert.rejects(
    db.transaction((client) =>
      client.query("DELETE FROM everonn_platform.page_assessments"),
    ),
    /immutable/,
  );
  const dependencies = { database: db, store, intelligence: runtime },
    endpoint = ["projects", project.id, "intelligence-runs", run.id, "report"];
  const response = await platformRequest(
    new Request(
      "http://localhost:3000/api/platform/" +
        endpoint.join("/") +
        "?download=1",
      { headers: { cookie: "everonn-session=" + owner.token } },
    ),
    endpoint,
    dependencies,
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition")!, /^attachment;/);
  assert.equal((await response.json()).report.runId, run.id);
  assert.equal(
    (
      await platformRequest(
        new Request("http://localhost:3000/api/platform/" + endpoint.join("/")),
        endpoint,
        dependencies,
      )
    ).status,
    401,
  );
  const unavailable = await startIntelligence(
    db,
    store,
    owner.user,
    project.id,
    { snapshotId: snapshot.id, requestKey: randomUUID() },
    runtime,
  );
  let blocked = unavailable;
  while (blocked.stage < 2)
    blocked = await runIntelligenceBatch(
      db,
      store,
      owner.user,
      project.id,
      blocked.id,
      undefined,
      { ...runtime, browser: null },
    );
  const partial = await intelligenceReport(
    db,
    store,
    owner.user,
    project.id,
    blocked.id,
  );
  assert.equal(partial.run.browserPages, 0);
  assert.equal(partial.report.status, "partial");
  assert.ok(
    partial.report.coverage.assessmentGaps.some((gap) =>
      gap.includes("Browser assessment incomplete"),
    ),
  );
  assert.equal(
    (await intelligenceDetail(db, owner.user, project.id, run.id)).reportSha256,
    run.reportSha256,
  );
});
test("inventory parser retains scoped feature and semantic evidence without inventing backend success", () => {
  const data = inspectHtml(html("/"), origin + "/", randomUUID());
  assert.ok(
    data.inventory.forms[0].fields.some(
      (field) => field.type === "email" && field.required,
    ),
  );
  assert.ok(data.inventory.assets.some((asset) => asset.kind === "iframe"));
  assert.ok(data.inventory.structuredData[0].valid);
  assert.ok(
    data.inventory.features
      .filter((feature) => ["enquiry", "booking"].includes(feature.kind))
      .every((feature) => feature.backend === "not_tested"),
  );
});
