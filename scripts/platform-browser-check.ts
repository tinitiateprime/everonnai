import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn, execFile } from "node:child_process";
import { createServer } from "node:net";
import { chromium } from "playwright";

async function main() {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "everonn-platform-browser-"),
  );
  const socket = createServer();
  await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const address = socket.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  const origin = `http://127.0.0.1:${port}`;
  const server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      windowsHide: true,
      stdio: "pipe",
      env: {
        ...process.env,
        NODE_ENV: "development",
        PLATFORM_TEST_OUTPUT: "1",
        PLATFORM_TEST_CRAWL_FIXTURE: "1",
        PLATFORM_LOCAL_MODE: "1",
        PLATFORM_DEV_AUTH: "1",
        AUTH_BASE_URL: origin,
        AUTH_OIDC_ISSUER: "",
        AUTH_OIDC_CLIENT_ID: "",
        AUTH_OIDC_CLIENT_SECRET: "",
        PLATFORM_DATABASE_DIR: path.join(directory, "database"),
        PLATFORM_OBJECTS_DIR: path.join(directory, "objects"),
      },
    },
  );
  let logs = "";
  server.stdout.on("data", (data) => {
    logs = (logs + String(data)).slice(-16000);
  });
  server.stderr.on("data", (data) => {
    logs = (logs + String(data)).slice(-16000);
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    for (let attempt = 0; attempt < 90; attempt++) {
      if (server.exitCode !== null)
        throw new Error("Workspace browser server exited: " + logs);
      try {
        if (
          (
            await fetch(origin + "/api/platform/session", {
              signal: AbortSignal.timeout(10000),
            })
          ).ok
        )
          break;
      } catch {
        /* Server is starting. */
      }
      if (attempt === 89)
        throw new Error("Workspace browser server did not start: " + logs);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    browser = await chromium.launch({
      headless: true,
      ...(process.env.CHROMIUM_EXECUTABLE_PATH
        ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH }
        : {}),
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true,
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin + "/projects");
    await page.getByRole("button", { name: "Open local workspace" }).click();
    await page
      .getByLabel("New workspace name")
      .fill("Foundation browser workspace");
    await page
      .getByRole("button", { name: "Create workspace", exact: true })
      .click();
    await page
      .getByRole("option", { name: "Foundation browser workspace" })
      .waitFor({ state: "attached" });
    await page
      .getByLabel("Business or project name")
      .fill("Foundation browser project");
    await page
      .getByLabel("Existing website URL")
      .fill("https://platform-discovery.example.com");
    await page
      .getByRole("button", { name: "Create project", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Foundation browser project", exact: true })
      .waitFor();
    assert.equal(
      await page.getByText("No website build yet", { exact: true }).count(),
      3,
    );
    await page.getByLabel("Upload a document (up to 64 MB)").setInputFiles({
      name: "business-source.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Verified browser source document"),
    });
    const link = page.getByRole("link", { name: "business-source.txt" });
    await link.waitFor();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      link.click(),
    ]);
    assert.equal(download.suggestedFilename(), "business-source.txt");
    await page.reload();
    await page
      .getByRole("button", { name: "Open project", exact: true })
      .click();
    await page.getByRole("link", { name: "business-source.txt" }).waitFor();
    const projectsBody = await (
      await context.request.get(origin + "/api/platform/projects")
    ).json();
    const projectId = projectsBody.projects[0].id as string;
    const projectApi = `${origin}/api/platform/projects/${projectId}`;
    const browserPost = async (route: string, body: unknown = {}) => {
      const result = await context.request.post(projectApi + route, {
        headers: { Origin: origin },
        data: body,
      });
      assert.ok(result.ok(), await result.text());
      return result.json();
    };
    // Browser controls exercise real authenticated routes and PostgreSQL/object persistence.
    await page
      .getByRole("button", { name: "Start new scan", exact: true })
      .click();
    await page
      .getByTestId("scan-progress")
      .filter({ hasText: /[1-9]\d* pages captured/ })
      .waitFor({ timeout: 60000 });
    await page.getByRole("button", { name: "Pause scan", exact: true }).click();
    await page
      .getByRole("button", { name: "Freeze source snapshot", exact: true })
      .waitFor({ timeout: 20000 });
    await page
      .getByLabel(
        "I acknowledge that this snapshot may have incomplete coverage.",
      )
      .check();
    await page
      .getByRole("button", { name: "Freeze source snapshot", exact: true })
      .click();
    await page.getByTestId("snapshot-summary").waitFor();
    const partialHistory = await (
      await context.request.get(projectApi + "/snapshots")
    ).json();
    const partialSnapshot = partialHistory.snapshots[0];
    assert.equal(partialSnapshot.coverage.complete, false);
    const partialCount = partialSnapshot.coverage.captured as number;
    const frozenHash = partialSnapshot.manifestSha256 as string;
    // The workspace shows only page counts while crawling (no per-page list or
    // captured-page viewer); full captured evidence stays available privately.
    assert.equal(
      await page.getByText(/(Scan|Snapshot) page inventory/).count(),
      0,
    );
    assert.equal(
      await page.getByRole("button", { name: "Read captured page" }).count(),
      0,
    );
    await page
      .getByTestId("scan-progress")
      .filter({ hasText: /pages captured/ })
      .waitFor();
    const inventory = await (
      await context.request.get(
        `${projectApi}/snapshots/${partialSnapshot.id}?offset=0`,
      )
    ).json();
    const capturedPage = inventory.pages.find(
      (item: { captureId?: string }) => item.captureId,
    );
    const capturedEvidence = await (
      await context.request.get(
        `${projectApi}/snapshots/${partialSnapshot.id}/pages/${capturedPage.captureId}`,
      )
    ).json();
    assert.match(capturedEvidence.evidence.page.text, /FULL_EVIDENCE_END_/);
    assert.ok(capturedEvidence.evidence.page.text.length > 12000);
    // Exercise the recovery display with expired lease metadata. Actual lease
    // reclamation/late-writer fencing is tested against SQL separately.
    await page.route(projectApi + "/discovery-runs", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.scans[0] = {
        ...body.scans[0],
        status: "running",
        leaseActive: false,
        leaseExpiresAt: new Date(0).toISOString(),
      };
      await route.fulfill({ response, json: body });
    });
    await page.reload();
    await page
      .getByRole("button", { name: "Open project", exact: true })
      .click();
    await page
      .getByTestId("scan-progress")
      .filter({ hasText: "interrupted — ready to resume" })
      .waitFor();
    await page.unroute(projectApi + "/discovery-runs");
    await page
      .getByRole("button", { name: "Resume scan", exact: true })
      .click();
    await page
      .getByText("All discovered pages in this scan's scope were captured.", {
        exact: true,
      })
      .waitFor({ timeout: 60000 });
    await page
      .getByRole("button", { name: "Freeze source snapshot", exact: true })
      .click();
    await page
      .getByTestId("snapshot-summary")
      .filter({ hasText: "Frozen: 16 pages" })
      .waitFor();
    const frozenResponse = await (
      await context.request.get(projectApi + "/snapshots/" + partialSnapshot.id)
    ).json();
    assert.equal(frozenResponse.snapshot.coverage.captured, partialCount);
    assert.equal(frozenResponse.snapshot.manifestSha256, frozenHash);
    assert.equal(frozenResponse.total, 16);
    // Confirm newer discovery cannot change old membership or manufacture builds.
    await page
      .getByRole("button", { name: "Start new scan", exact: true })
      .click();
    await page.getByRole("button", { name: "Pause scan", exact: true }).click();
    await page
      .getByRole("button", { name: "Freeze source snapshot", exact: true })
      .waitFor({ timeout: 20000 });
    const oldAgain = await (
      await context.request.get(projectApi + "/snapshots/" + partialSnapshot.id)
    ).json();
    assert.equal(oldAgain.snapshot.manifestSha256, frozenHash);
    assert.equal(oldAgain.snapshot.coverage.captured, partialCount);
    const scanHistory = await (
      await context.request.get(projectApi + "/discovery-runs")
    ).json();
    const newScan = scanHistory.scans[0];
    const rejected = await context.request.post(
      projectApi + "/discovery-runs/" + newScan.id + "/snapshots",
      { headers: { Origin: origin }, data: { allowIncomplete: false } },
    );
    assert.equal(rejected.status(), 422);
    assert.equal(
      await page.getByText("No website build yet", { exact: true }).count(),
      3,
    );
    await browserPost("/discovery-runs/" + newScan.id + "/pause");
    await page
      .getByRole("button", {
        name: "Refresh source and approvals",
        exact: true,
      })
      .click();
    const snapshotHistory = await (
      await context.request.get(projectApi + "/snapshots")
    ).json();
    const completeSnapshot = snapshotHistory.snapshots.find(
      (snapshot: { coverage: { complete: boolean } }) =>
        snapshot.coverage.complete,
    );
    assert.ok(completeSnapshot);
    await page
      .getByRole("button", {
        name: "Refresh inspection sources and history",
        exact: true,
      })
      .click();
    await page
      .getByLabel("Existing frozen source for analysis")
      .selectOption(completeSnapshot.id);
    await page
      .getByRole("button", { name: "Analyse frozen source", exact: true })
      .click();
    await page
      .getByText("Public-site assessment complete within scope", {
        exact: true,
      })
      .waitFor({ timeout: 300000 });
    const inspections = await (
      await context.request.get(projectApi + "/intelligence-runs")
    ).json();
    const inspection = inspections.runs.find(
      (run: { stage: number }) => run.stage === 2,
    );
    assert.ok(inspection);
    const audit = await (
      await context.request.get(
        projectApi +
          "/intelligence-runs/" +
          inspection.id +
          "/report?download=1",
      )
    ).json();
    assert.equal(audit.report.pages.length, 16);
    assert.equal(audit.report.coverage.browserAssessed, 16);
    assert.equal(audit.report.mode, "fixture");
    assert.ok(
      audit.report.findings.some(
        (item: { area: string }) => item.area === "seo",
      ),
    );
    // Before the agent has generated a website, owners cannot correct it yet.
    await page
      .getByRole("heading", {
        name: "How our agent can make your website better",
      })
      .waitFor();
    assert.equal(await page.getByLabel("Correct the agent").count(), 0);
    await page
      .getByText(
        /Once the agent has generated your website, you can correct it/,
      )
      .waitFor();
    await page.getByRole("tab", { name: "Findings", exact: true }).click();
    await page.getByLabel("Filter audit findings").fill("SEO");
    await page
      .getByRole("heading", {
        name: "UX, SEO, accessibility and feature findings",
      })
      .waitFor();
    await page.getByRole("tab", { name: "Pages", exact: true }).click();
    await page
      .getByRole("button", { name: "Inspect page evidence", exact: true })
      .first()
      .click();
    await page
      .getByRole("img", {
        name: "Observed source layout at 390px",
        exact: true,
      })
      .waitFor();
    await page
      .getByRole("tab", { name: "Improvement plan", exact: true })
      .click();
    await page
      .getByRole("heading", {
        name: "What to improve and how to verify it",
        exact: true,
      })
      .waitFor();
    await page
      .getByLabel("Frozen source for fact review")
      .selectOption(completeSnapshot.id);
    await page
      .getByRole("button", { name: "Extract business facts", exact: true })
      .click();
    await page
      .getByLabel(
        "I reviewed these facts, confirm the entered values, and intentionally omit blank optional fields.",
      )
      .check();
    await page
      .getByRole("button", { name: "Approve business facts", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Prepare website blueprint", exact: true })
      .click();
    await page
      .getByLabel(
        "I approve these page outcomes and the enquiry inbox scope for all three alternatives.",
      )
      .check();
    await page
      .getByRole("button", { name: "Approve website blueprint", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "Generate three complete websites",
        exact: true,
      })
      .click();
    const deadline = Date.now() + 600000;
    let previousProgress = "";
    while (true) {
      if (Date.now() > deadline)
        throw new Error(
          "Workspace generation did not finish within ten minutes.",
        );
      const response = await context.request.get(projectApi + "/builds");
      assert.equal(response.status(), 200);
      const history = await response.json();
      const rows = history.builds as {
        status: string;
        leaseActive: boolean;
        error: string | null;
      }[];
      const failure = rows.find((build) => build.status === "failed");
      if (failure)
        throw new Error("Workspace candidate failed: " + failure.error);
      if (
        rows.some(
          (build) =>
            ["designing", "compiling", "verifying"].includes(build.status) &&
            !build.leaseActive,
        )
      )
        throw new Error(
          "Workspace generation was interrupted and its lease expired; resume is required.",
        );
      const progress = rows.map((build) => build.status).join(", ");
      if (progress !== previousProgress) {
        console.log("Workspace generation: " + progress);
        previousProgress = progress;
      }
      if (rows.length === 3 && rows.every((build) => build.status === "ready"))
        break;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    await page
      .getByText(
        "All three websites passed the required checks for this approved blueprint.",
        { exact: true },
      )
      .waitFor();
    assert.equal(
      await page
        .getByRole("link", { name: "Open verified website", exact: true })
        .count(),
      3,
    );
    // With generated websites, the report's growth advice offers corrections.
    await page.getByRole("tab", { name: "Overview", exact: true }).click();
    await page.getByLabel("Correct the agent").waitFor({ timeout: 20_000 });
    const buildHistory = await (
      await context.request.get(projectApi + "/builds")
    ).json();
    const ready = buildHistory.builds.filter(
      (build: { status: string }) => build.status === "ready",
    );
    assert.equal(ready.length, 3);
    await page.getByLabel("Website build to review").selectOption(ready[0].id);
    for (const label of [
      "Brand, layout and visual hierarchy",
      "Page content and approved business facts",
      "Mobile layout and keyboard use",
      "Working enquiry form and disclosed limitations",
      "Meaningful differences from the other alternatives",
    ])
      await page.getByLabel(label, { exact: true }).check();
    await page
      .getByLabel("Review notes", { exact: true })
      .fill(
        "Browser review of preserved facts, mobile layouts and distinct alternatives.",
      );
    await page
      .getByRole("button", { name: "Record website review", exact: true })
      .click();
    await page.getByText(/Latest human review: approved/).waitFor();
    await page
      .getByRole("button", {
        name: "View evidence and comparison",
        exact: true,
      })
      .click();
    await page
      .getByText("Automated preview checks: passed. Human review: approved.", {
        exact: true,
      })
      .waitFor();
    const comparison = await context.request.get(
      projectApi + "/builds/" + ready[0].id + "/report?download=1",
    );
    assert.equal(comparison.status(), 200);
    assert.match(comparison.headers()["content-disposition"], /^attachment;/);
    const report = await comparison.json();
    assert.equal(report.buildId, ready[0].id);
    assert.equal(report.sealSha256, ready[0].sealSha256);
    assert.equal(report.humanReviewApproved, true);
    assert.equal(report.source.scope.evidenceMode, "fixture");
    assert.equal(
      report.claims.find(
        (item: { key: string }) => item.key === "business_outcomes",
      ).outcome,
      "unassessed",
    );
    const preview = await context.newPage();
    preview.on("pageerror", (error) => errors.push(error.message));
    await preview.goto(projectApi + "/builds/" + ready[0].id + "/preview/");
    await preview.getByLabel("Your name").fill("Browser enquiry visitor");
    await preview.getByLabel("Email address").fill("visitor@example.com");
    await preview
      .getByLabel("Your message")
      .fill(
        "Real browser enquiry saved through the generated Next.js application.",
      );
    await preview
      .getByRole("button", { name: "Submit enquiry", exact: true })
      .click();
    await preview
      .getByRole("status")
      .filter({ hasText: "Your enquiry was saved to the project inbox." })
      .waitFor();
    await preview.close();
    await page
      .getByRole("button", { name: "Refresh enquiries", exact: true })
      .click();
    await page.getByText("Browser enquiry visitor", { exact: true }).waitFor();
    const oldSeal = ready[0].sealSha256;
    await page.reload();
    await page
      .getByRole("button", { name: "Open project", exact: true })
      .click();
    const knowledge = await (
      await context.request.get(projectApi + "/knowledge")
    ).json();
    await page
      .getByLabel("Blueprint history")
      .selectOption(
        knowledge.blueprints.find(
          (row: { status: string }) => row.status === "approved",
        ).id,
      );
    await page
      .getByText(
        "All three websites passed the required checks for this approved blueprint.",
        { exact: true },
      )
      .waitFor();
    await page.getByLabel("Website build to review").selectOption(ready[0].id);
    await page.getByText(/Latest human review: approved/).waitFor();
    assert.equal(
      (
        await (
          await context.request.get(projectApi + "/builds/" + ready[0].id)
        ).json()
      ).build.sealSha256,
      oldSeal,
    );
    const other = await browser.newContext();
    const unauthenticated = await other.request.get(
      origin + "/api/platform/projects",
    );
    assert.equal(unauthenticated.status(), 401);
    assert.equal(
      (
        await other.request.get(
          projectApi + "/builds/" + ready[0].id + "/preview/",
        )
      ).status(),
      401,
    );
    assert.equal(
      (
        await other.request.get(
          projectApi + "/builds/" + ready[0].id + "/report",
        )
      ).status(),
      401,
    );
    assert.equal(
      (await other.request.get(projectApi + "/build-reviews")).status(),
      401,
    );
    assert.equal(
      (
        await other.request.get(
          projectApi + "/intelligence-runs/" + inspection.id + "/report",
        )
      ).status(),
      401,
    );
    assert.equal(
      (
        await other.request.get(projectApi + "/snapshots/" + partialSnapshot.id)
      ).status(),
      401,
    );
    await other.close();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () =>
          Math.max(
            document.documentElement.scrollWidth,
            document.body.scrollWidth,
          ) >
          innerWidth + 1,
      ),
      false,
    );
    await mkdir("artifacts", { recursive: true });
    await page.screenshot({
      path: "artifacts/platform-workspace-mobile.png",
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByRole("button", { name: "Open local workspace" }).waitFor();
    assert.equal(
      (await context.request.get(origin + "/api/platform/projects")).status(),
      401,
    );
    console.log(
      "Workspace browser checks passed: local sign-in, private files, discovery/snapshots, fact approval, immutable blueprint, three actual Next.js compilations and browser verifications, preview enquiry/inbox, reload persistence, anonymous denial, mobile layout and logout. Source and AI design used labeled fixtures; compilation, SQL, storage and feature execution were real.",
    );
  } finally {
    await browser?.close();
    if (server.exitCode === null && server.pid) {
      if (process.platform === "win32")
        await new Promise<void>((resolve) =>
          execFile(
            "taskkill",
            ["/pid", String(server.pid), "/T", "/F"],
            { windowsHide: true },
            () => resolve(),
          ),
        );
      else {
        server.kill("SIGTERM");
        await new Promise<void>((resolve) =>
          server.once("exit", () => resolve()),
        );
      }
    }
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith("everonn-platform-browser-"));
    await rm(resolved, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Workspace browser check failed.",
  );
  process.exitCode = 1;
});
