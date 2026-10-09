import { chromium } from "playwright";
import { safeResource } from "./network";

export async function inspectWebsite(html: string, signal?: AbortSignal) {
  const errors: string[] = [],
    warnings: string[] = [];
  const browser = await chromium
    .launch({
      headless: true,
      ...(process.env.CHROMIUM_EXECUTABLE_PATH
        ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH }
        : {}),
    })
    .catch(() => null);
  if (!browser)
    return {
      errors,
      warnings: [
        "Automated browser layout review was unavailable. Review both preview sizes before using this design.",
      ],
    };
  try {
    const context = await browser.newContext({
      serviceWorkers: "block",
      javaScriptEnabled: false,
    });
    let resources = 0;
    await context.route("**/*", async (route) => {
      if (++resources > 40) return route.abort();
      try {
        const resource = await safeResource(route.request().url(), {
          signal,
          maxBytes: 3_000_000,
        });
        await route.fulfill({
          status: resource.status,
          body: resource.body,
          contentType: String(
            resource.headers["content-type"] ?? "application/octet-stream",
          ),
        });
      } catch {
        await route.abort().catch(() => {});
      }
    });
    const page = await context.newPage();
    for (const width of [390, 1440]) {
      signal?.throwIfAborted();
      await page.setViewportSize({ width, height: 900 });
      await page.setContent(html, {
        waitUntil: "domcontentloaded",
        timeout: 10000,
      });
      await page
        .waitForLoadState("networkidle", { timeout: 3000 })
        .catch(() => {});
      const check = await page.evaluate(() => ({
        overflow:
          Math.max(
            document.documentElement.scrollWidth,
            document.body.scrollWidth,
          ) - innerWidth,
        headings: [...document.querySelectorAll("h1")].filter(
          (h) => h.getBoundingClientRect().width > 0,
        ).length,
        brokenImages: [...document.images].filter(
          (i) => i.complete && i.naturalWidth === 0,
        ).length,
      }));
      if (check.overflow > 10)
        errors.push(
          `The website overflows horizontally by ${check.overflow}px at viewport ${width}px. Fix responsive widths and wrapping.`,
        );
      if (!check.headings)
        errors.push(`The main heading is hidden at viewport ${width}px.`);
      if (check.brokenImages)
        warnings.push(
          `Some source images did not load at ${width}px. Review the preview.`,
        );
    }
  } finally {
    await browser.close();
  }
  return { errors, warnings: [...new Set(warnings)] };
}
