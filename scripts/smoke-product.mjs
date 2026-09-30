import { chromium } from "playwright-core";

const executablePath = process.platform === "win32"
  ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  : undefined;
const baseURL = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const smokeEmail = String(process.env.SMOKE_AUTH_EMAIL || "").trim();
const smokePassword = String(process.env.SMOKE_AUTH_PASSWORD || "");
const smokeName = String(process.env.SMOKE_AUTH_NAME || "EverOnn Smoke Owner").trim();
const smokeSetupToken = String(process.env.SMOKE_AUTH_SETUP_TOKEN || "");
if (!smokeEmail || !smokePassword) {
  throw new Error("Set SMOKE_AUTH_EMAIL and SMOKE_AUTH_PASSWORD to an owner account before running the product smoke test.");
}
const browser = await chromium.launch({ headless: true, executablePath });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
let originalWorkspace;

async function signIn(page) {
  await page.goto(`${baseURL}/login`, { waitUntil: "networkidle" });
  if (new URL(page.url()).pathname.startsWith("/dashboard")) return;
  const firstRun = await page.getByRole("heading", { name: "Create the owner account." }).count();
  if (firstRun) {
    await page.getByLabel("Owner name").fill(smokeName);
    await page.getByLabel("Work email").fill(smokeEmail);
    await page.getByLabel("Password", { exact: true }).fill(smokePassword);
    await page.getByLabel("Confirm password").fill(smokePassword);
    const setupToken = page.getByLabel("Owner setup token");
    if (await setupToken.count()) {
      if (!smokeSetupToken) throw new Error("This deployment also requires SMOKE_AUTH_SETUP_TOKEN for first-owner setup.");
      await setupToken.fill(smokeSetupToken);
    }
    await page.getByRole("button", { name: "Create owner and sign in" }).click();
  } else {
    await page.getByLabel("Work email").fill(smokeEmail);
    await page.getByLabel("Password").fill(smokePassword);
    await page.getByRole("button", { name: "Sign in securely" }).click();
  }
  await page.waitForURL(/\/dashboard(?:\/.*)?$/);
}

try {
  const page = await context.newPage();
  await signIn(page);
  const snapshotResponse = await page.request.get(`${baseURL}/api/workspace`, { headers: { "Cache-Control": "no-store" } });
  if (!snapshotResponse.ok()) throw new Error(`Could not snapshot workspace JSON (${snapshotResponse.status()}).`);
  const snapshotPayload = await snapshotResponse.json();
  originalWorkspace = snapshotPayload.workspace;
  if (snapshotPayload.actor?.role !== "owner") throw new Error("The smoke test account must have the owner role.");
  await page.goto(`${baseURL}/dashboard`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /Good morning/ }).waitFor();
  await page.getByRole("link", { name: /Test the AI front desk/ }).click();
  await page.waitForURL(/\/dashboard\/ai-agent$/);
  const message = page.locator(".eo-agent-console input");
  await message.fill("My name is Chris and my furnace is smoking. Call me at +1 555 555 1212.");
  await message.press("Enter");
  const aiSafetyReply = page.locator(".eo-transcript .assistant").nth(1);
  await aiSafetyReply.waitFor({ timeout: 60_000 });
  if (!/emergency|fire department|911|immediate danger/i.test(await aiSafetyReply.innerText())) throw new Error("Gemini did not return an emergency safety response.");
  await page.getByRole("button", { name: /Finish & save summary/ }).click();
  await page.getByText(/Saved to inbox/).waitFor();

  await page.goto(`${baseURL}/dashboard/website`, { waitUntil: "networkidle" });
  const previousToken = originalWorkspace.websiteProject?.privateToken || "";
  const generationButton = page.locator(".eo-page-heading button");
  await generationButton.click();
  await page.waitForFunction(() => document.querySelector(".eo-page-heading button")?.textContent?.includes("Generating"));
  await page.waitForFunction(() => !document.querySelector(".eo-page-heading button")?.textContent?.includes("Generating"), undefined, { timeout: 120_000 });
  await page.getByText("Private preview workflow").waitFor();
  const generatedWorkspace = await (await page.request.get(`${baseURL}/api/workspace`, { headers: { "Cache-Control": "no-store" } })).json();
  const expectedToken = generatedWorkspace.workspace?.websiteProject?.privateToken;
  if (!expectedToken || expectedToken === previousToken) throw new Error("Website regeneration did not create a fresh multi-page project.");
  await page.waitForFunction((token) => [...document.querySelectorAll("a")].some((link) => link.getAttribute("href")?.includes(token)), expectedToken);
  const previewHref = await page.getByRole("link", { name: /Open .*preview/ }).getAttribute("href");
  if (!previewHref) throw new Error("Generated website did not expose its private preview URL.");
  await page.waitForFunction(async (href) => {
    const response = await fetch("/api/workspace", { cache: "no-store" });
    const payload = await response.json();
    return Boolean(payload.workspace?.websiteProject?.privateToken && href.includes(payload.workspace.websiteProject.privateToken));
  }, previewHref);

  const preview = await context.newPage();
  await preview.goto(`${baseURL}${previewHref}`, { waitUntil: "networkidle" });
  await preview.locator(".client-preview").waitFor();
  const heroImage = preview.locator(".client-hero-media img");
  await preview.locator(".client-hero-media img, .client-hero-art").first().waitFor();
  if (await heroImage.count()) {
    const previewImages = preview.locator(".client-preview img");
    const imageCount = await previewImages.count();
    if (imageCount < 2) throw new Error("Generated preview did not render enough Pexels images.");
    for (let index = 0; index < imageCount; index += 1) {
      const image = previewImages.nth(index);
      await image.scrollIntoViewIfNeeded();
      await image.evaluate((element) => element.complete
        ? undefined
        : new Promise((resolve) => {
            element.addEventListener("load", resolve, { once: true });
            element.addEventListener("error", resolve, { once: true });
          }));
    }
    const failedImages = await previewImages.evaluateAll((images) => images
      .filter((image) => !image.complete || image.naturalWidth === 0)
      .map((image) => image.currentSrc || image.src));
    if (failedImages.length) throw new Error(`Generated preview images failed to load: ${failedImages.join(", ")}`);
    const serviceImageCount = await preview.locator(".client-service-media img").count();
    const galleryImageCount = await preview.locator(".client-gallery-photo img").count();
    if (!serviceImageCount || !galleryImageCount) throw new Error("Pexels media did not render in every generated website section.");
  } else {
    await preview.locator(".client-photo-fallback").first().waitFor();
  }

  await preview.locator(".client-header nav").getByRole("link", { name: "Services", exact: true }).click();
  await preview.waitForURL(/\/preview\/[^/]+\/services\?theme=/);
  await preview.locator(".client-services-page .client-service-grid article").first().waitFor();
  await preview.locator(".client-services-page .client-service-grid article h3 a").first().click();
  await preview.waitForURL(/\/preview\/[^/]+\/services\/[^?]+\?theme=/);
  await preview.waitForTimeout(500);
  if (!await preview.locator(".client-service-detail").count()) {
    const debug = await preview.evaluate(async () => {
      const payload = await (await fetch("/api/workspace", { cache: "no-store" })).json();
      return { url: location.href, token: payload.workspace?.websiteProject?.privateToken, slugs: payload.workspace?.websiteProject?.spec?.services?.map((service) => service.slug) };
    });
    throw new Error(`Generated service-detail route did not render (${JSON.stringify(debug)}): ${(await preview.locator("body").innerText()).slice(0, 700)}`);
  }
  await preview.locator(".client-header nav").getByRole("link", { name: "About", exact: true }).click();
  await preview.waitForURL(/\/preview\/[^/]+\/about\?theme=/);
  await preview.locator(".client-benefits").waitFor();
  await preview.locator(".client-header nav").getByRole("link", { name: "Contact", exact: true }).click();
  await preview.waitForURL(/\/preview\/[^/]+\/contact\?theme=/);
  await preview.locator(".client-contact-page").waitFor();
  await preview.locator(".client-logo").click();
  await preview.waitForURL(/\/preview\/[^/?]+\?theme=/);
  await preview.locator(".client-hero").waitFor();

  await preview.getByRole("button", { name: /Chat with/ }).click();
  const assistantInput = preview.getByLabel("Message the AI assistant");
  await assistantInput.waitFor();
  await preview.waitForFunction(() => !document.querySelector("[aria-label='Message the AI assistant']")?.disabled);
  await assistantInput.fill("What are your business hours?");
  await assistantInput.press("Enter");
  await preview.locator(".client-assistant-messages p.visitor").waitFor();
  await preview.getByRole("button", { name: "Close assistant" }).click();
  await preview.getByRole("button", { name: /Talk to .* AI/ }).waitFor();

  await preview.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  if (process.env.SMOKE_PREVIEW_SCREENSHOT) {
    await preview.screenshot({ path: process.env.SMOKE_PREVIEW_SCREENSHOT, fullPage: true });
  }
  if (process.env.SMOKE_PREVIEW_MOBILE_SCREENSHOT) {
    await preview.setViewportSize({ width: 390, height: 844 });
    await preview.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await preview.screenshot({ path: process.env.SMOKE_PREVIEW_MOBILE_SCREENSHOT, fullPage: true });
  }
  await preview.close();

  await page.getByRole("button", { name: /Select editorial/ }).click();
  await page.getByRole("button", { name: /Claim this preview/ }).click();
  await page.getByRole("button", { name: /Verify business owner/ }).click();
  await page.getByRole("button", { name: /Approve for publishing/ }).click();
  await page.getByRole("button", { name: /Publish website/ }).click();
  await page.getByText("published", { exact: true }).waitFor();
  await page.waitForFunction(async (token) => {
    const response = await fetch("/api/workspace", { cache: "no-store" });
    const payload = await response.json();
    return payload.workspace?.websiteProject?.privateToken === token && payload.workspace?.websiteProject?.status === "published";
  }, expectedToken);
  const publishedPayload = await (await page.request.get(`${baseURL}/api/workspace`, { headers: { "Cache-Control": "no-store" } })).json();
  const publicSlug = publishedPayload.workspace.websiteProject.publicSlug;
  const published = await context.newPage();
  await published.setViewportSize({ width: 1280, height: 900 });
  const publicRequests = [];
  published.on("request", (request) => publicRequests.push(request.url()));
  const publishedResponse = await published.goto(`${baseURL}/sites/${publicSlug}`, { waitUntil: "networkidle" });
  try {
    await published.locator(".client-preview").waitFor({ timeout: 8_000 });
  } catch {
    const liveWorkspace = await (await page.request.get(`${baseURL}/api/workspace`, { headers: { "Cache-Control": "no-store" } })).json();
    const liveProject = liveWorkspace.workspace?.websiteProject;
    const retryResponse = await page.request.get(`${baseURL}/sites/${publicSlug}`, { headers: { "Cache-Control": "no-store" } });
    throw new Error(`Published site failed to render (${publishedResponse?.status()}, retry ${retryResponse.status()}, requested slug ${publicSlug}, live slug ${liveProject?.publicSlug}, expected token ${expectedToken}, live token ${liveProject?.privateToken}, live status ${liveProject?.status}, live concept ${liveProject?.selectedConcept}): ${(await published.locator("body").innerText()).slice(0, 600)}`);
  }
  await published.locator(".client-header nav").getByRole("link", { name: "Services", exact: true }).click();
  await published.waitForURL(new RegExp(`/sites/${publicSlug}/services$`));
  await published.locator(".client-services-page").waitFor();
  if (publicRequests.some((url) => url.includes("/api/workspace"))) throw new Error("Published sites must not load the private workspace API.");
  const leadStatus = await published.evaluate(async (slug) => {
    const response = await fetch("/api/site-assistant/lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publicSlug: slug, callerName: "Smoke Visitor", callerPhone: "+1 555 010 0200", reason: "Public callback test" }),
    });
    return response.status;
  }, publicSlug);
  if (leadStatus !== 201) throw new Error(`Published lead capture failed with HTTP ${leadStatus}.`);
  await published.close();

  const mobile = await context.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(`${baseURL}/dashboard`, { waitUntil: "networkidle" });
  await mobile.getByRole("button", { name: "Sign out" }).waitFor();
  await mobile.getByRole("button", { name: "Open navigation" }).click();
  await mobile.getByRole("button", { name: "Knowledge" }).waitFor();
  await mobile.getByRole("complementary").getByRole("button", { name: "Close navigation" }).click();
  await mobile.close();

  await page.goto(`${baseURL}/dashboard`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/login/);
  await signIn(page);
  await page.getByRole("heading", { name: /Good morning/ }).waitFor();

  process.stdout.write("EverOnn product smoke test passed.\n");
} finally {
  let restoreError;
  if (originalWorkspace) {
    const restoreResponse = await context.request.put(`${baseURL}/api/workspace`, {
      headers: { "Content-Type": "application/json", "x-everonn-workspace": originalWorkspace.workspaceId },
      data: { workspace: originalWorkspace },
    });
    if (!restoreResponse.ok()) restoreError = new Error(`Could not restore workspace JSON (${restoreResponse.status()}).`);
  }
  await context.close();
  await browser.close();
  if (restoreError) throw restoreError;
}
