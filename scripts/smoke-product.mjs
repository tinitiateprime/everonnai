import { chromium } from "playwright-core";

const executablePath = process.platform === "win32"
  ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  : undefined;
const baseURL = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const snapshotResponse = await fetch(`${baseURL}/api/workspace`, { cache: "no-store" });
if (!snapshotResponse.ok) throw new Error(`Could not snapshot workspace JSON (${snapshotResponse.status}).`);
const snapshotPayload = await snapshotResponse.json();
const originalWorkspace = snapshotPayload.workspace;
const browser = await chromium.launch({ headless: true, executablePath });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`${baseURL}/dashboard`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /Good morning/ }).waitFor();
  await page.getByRole("link", { name: /Test the AI front desk/ }).click();
  await page.waitForURL(/\/dashboard\/ai-agent$/);
  const message = page.getByPlaceholder(/Try: My name is Chris/);
  await message.fill("My name is Chris and my furnace is smoking. Call me at +1 555 555 1212.");
  await message.press("Enter");
  await page.getByText(/contact local emergency services now/i).waitFor();
  await page.getByRole("button", { name: /Finish & save summary/ }).click();
  await page.getByText(/Saved to inbox/).waitFor();

  await page.goto(`${baseURL}/dashboard/website`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Generate three concepts/ }).click();
  await page.getByText("Private preview workflow").waitFor();
  await page.getByRole("button", { name: /Select editorial/ }).click();
  await page.getByRole("button", { name: /Claim this preview/ }).click();
  await page.getByRole("button", { name: /Verify business owner/ }).click();
  await page.getByRole("button", { name: /Approve for publishing/ }).click();
  await page.getByRole("button", { name: /Publish website/ }).click();
  await page.getByText("published", { exact: true }).waitFor();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(`${baseURL}/dashboard`, { waitUntil: "networkidle" });
  await mobile.getByRole("button", { name: "Open navigation" }).click();
  await mobile.getByRole("button", { name: "Knowledge" }).waitFor();
  await mobile.getByRole("complementary").getByRole("button", { name: "Close navigation" }).click();

  const login = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  await login.goto(`${baseURL}/login`, { waitUntil: "networkidle" });
  await login.getByRole("button", { name: "Continue securely" }).click();
  await login.getByLabel("Verification code").fill("123456");
  await login.getByRole("button", { name: "Verify and open workspace" }).click();
  await login.waitForURL(/\/dashboard$/);

  process.stdout.write("EverOnn product smoke test passed.\n");
} finally {
  await browser.close();
  const restoreResponse = await fetch(`${baseURL}/api/workspace`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "x-everonn-workspace": originalWorkspace.workspaceId },
    body: JSON.stringify({ workspace: originalWorkspace }),
  });
  if (!restoreResponse.ok) throw new Error(`Could not restore workspace JSON (${restoreResponse.status}).`);
}
