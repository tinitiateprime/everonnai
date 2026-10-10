import { createServer } from "node:http";
import { chromium } from "playwright";
import { load } from "cheerio";
import type { SiteContent } from "./compiler";
import type { BuildManifest, BuildVerification } from "./contracts";
import { enquiryInput } from "./contracts";
export function previewFile(urlPath: string): string | null {
  let value: string;
  try {
    value = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (
    value.includes("\\") ||
    value.includes("\0") ||
    value.split("/").some((p) => p === "." || p === "..")
  )
    return null;
  const name = value.replace(/^\//, "");
  return !name
    ? "index.html"
    : value.endsWith("/")
      ? name + "index.html"
      : name.includes(".")
        ? name
        : name + "/index.html";
}
export function contentSecurityPolicy(html: string) {
  // Only trusted compiler-generated inline scripts are present in exported HTML.
  const $ = load(html);
  const hashes = $("script:not([src])")
    .toArray()
    .map((el) => `'sha256-${requireHash($(el).html() || "")}'`);
  return `default-src 'none'; script-src 'self' ${hashes.join(" ")}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'self'; base-uri 'none'; object-src 'none'`;
}
import { createHash } from "node:crypto";
const requireHash = (value: string) =>
  createHash("sha256").update(value).digest("base64");
export function mediaType(name: string) {
  return name.endsWith(".html")
    ? "text/html; charset=utf-8"
    : name.endsWith(".js")
      ? "application/javascript; charset=utf-8"
      : name.endsWith(".css")
        ? "text/css; charset=utf-8"
        : name.endsWith(".json")
          ? "application/json"
          : name.endsWith(".txt")
            ? "text/plain; charset=utf-8"
            : "application/octet-stream";
}
const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
export async function verifySite(
  output: Map<string, Uint8Array>,
  content: SiteContent,
  manifest: BuildManifest,
  seal: string,
  submit: (input: ReturnType<typeof enquiryInput.parse>) => Promise<unknown>,
  signal?: AbortSignal,
): Promise<BuildVerification> {
  const checks: BuildVerification["checks"] = [];
  const graph = new Map<string, Set<string>>();
  for (const page of content.pages) {
    const bytes = output.get(
      previewFile(page.path === "/" ? "/" : page.path + "/")!,
    );
    if (!bytes) {
      checks.push({
        key: `route:${page.path}`,
        outcome: "fail",
        details: "Required exported page is missing.",
      });
      continue;
    }
    const $ = load(Buffer.from(bytes).toString());
    const targets = new Set<string>();
    graph.set(page.path, targets);
    const text = normalize(
      $(".source-paragraph")
        .toArray()
        .map((el) => $(el).text())
        .join(" "),
    );
    checks.push({
      key: `content:${page.path}`,
      outcome: text === normalize(page.text) ? "pass" : "fail",
      details:
        text === normalize(page.text)
          ? "All approved source text is present."
          : "Approved source text was lost or changed.",
    });
    checks.push({
      key: `semantics:${page.path}`,
      outcome:
        $("h1").length === 1 &&
        $("main").length === 1 &&
        $("title").text().trim()
          ? "pass"
          : "fail",
      details:
        "One main landmark, one primary heading and a document title required.",
    });
    checks.push({
      key: `metadata:${page.path}`,
      outcome: $("title").text().trim() === page.title ? "pass" : "fail",
      details: "The document title matches this approved page.",
    });
    const factsMatch =
      $(".brand").text() === content.business.business_name &&
      Object.entries(content.business)
        .filter(([key]) => key !== "business_name")
        .every(
          ([key, value]) =>
            $(`[data-fact-key="${key}"] [data-fact-value]`).text() === value,
        );
    checks.push({
      key: `facts:${page.path}`,
      outcome: factsMatch ? "pass" : "fail",
      details:
        "Rendered business details match the exact owner-approved fact set.",
    });
    for (const href of $("a[href]")
      .toArray()
      .map((el) => $(el).attr("href")!)) {
      if (href.startsWith(content.basePath)) {
        const target =
          href.slice(content.basePath.length).replace(/\/$/, "") || "/";
        targets.add(target);
        if (
          !content.pages.some((p) => p.path === target) &&
          !content.redirects.some((p) => p.path === target)
        )
          checks.push({
            key: `links:${page.path}`,
            outcome: "fail",
            details: "An internal link targets an unknown route.",
          });
      }
    }
  }
  if (!checks.some((c) => c.key.startsWith("links:")))
    checks.push({
      key: "internal_links",
      outcome: "pass",
      details: "All generated internal links target approved routes.",
    });
  const reachable = new Set<string>(),
    pending = ["/"];
  while (pending.length) {
    const path = pending.pop()!;
    if (reachable.has(path)) continue;
    reachable.add(path);
    for (const target of graph.get(path) ?? []) pending.push(target);
    const redirect = content.redirects.find((item) => item.path === path);
    if (redirect) pending.push(redirect.target);
  }
  checks.push({
    key: "navigation_coverage",
    outcome: content.pages.every((page) => reachable.has(page.path))
      ? "pass"
      : "fail",
    details:
      "Every rendered route is reachable from the home page through actual document links.",
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined,
    browserVersion: string | null = null;
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host}`);
      if (url.pathname === content.enquiryEndpoint && req.method === "POST") {
        const pieces: Buffer[] = [];
        let size = 0;
        for await (const piece of req) {
          size += piece.length;
          if (size > 16000) throw new Error("Oversized enquiry");
          pieces.push(piece);
        }
        const result = await submit(
          enquiryInput.parse(JSON.parse(Buffer.concat(pieces).toString())),
        );
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
        return;
      }
      const relative = url.pathname.startsWith(content.basePath + "/")
        ? url.pathname.slice(content.basePath.length)
        : null;
      const redirect = content.redirects.find(
        (p) => p.path === relative?.replace(/\/$/, "") || p.path === relative,
      );
      if (redirect) {
        res.writeHead(308, {
          Location:
            content.basePath +
            (redirect.target === "/" ? "/" : redirect.target + "/"),
        });
        res.end();
        return;
      }
      const file = relative ? previewFile(relative) : null,
        body = file ? output.get(file) : undefined;
      res.writeHead(body ? 200 : 404, {
        "Content-Type": mediaType(file || "404.html"),
        "Content-Security-Policy":
          body && file?.endsWith(".html")
            ? contentSecurityPolicy(Buffer.from(body).toString())
            : "default-src 'none'",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(body || output.get("404.html") || "Not found");
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Verification request failed." }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Verification server unavailable");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(process.env.CHROMIUM_EXECUTABLE_PATH
        ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH }
        : {}),
    });
    browserVersion = browser.version();
    const context = await browser.newContext();
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin
        ? route.continue()
        : route.abort(),
    );
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const item of content.pages) {
      if (signal?.aborted) throw new Error("Verification interrupted");
      for (const width of [1440, 768, 390]) {
        await page.setViewportSize({ width, height: 900 });
        const response = await page.goto(
          origin +
            content.basePath +
            (item.path === "/" ? "/" : item.path + "/"),
          { waitUntil: "load", timeout: 15000 },
        );
        const result = await page.evaluate(() => {
          const el = document.querySelector("[data-source-content]");
          let visible = !!el;
          const required = [
            ...(el ? [el, ...el.querySelectorAll(".source-paragraph")] : []),
            ...document.querySelectorAll(
              ".brand, [data-fact-value], .enquiry label, .enquiry button",
            ),
          ];
          for (const node of required) {
            if (
              !node.getBoundingClientRect().height ||
              Number.parseFloat(getComputedStyle(node).fontSize) < 12
            )
              visible = false;
            for (
              let current: Element | null = node;
              current;
              current = current.parentElement
            ) {
              const style = getComputedStyle(current);
              if (
                style.display === "none" ||
                style.visibility !== "visible" ||
                Number(style.opacity) <= 0 ||
                (["hidden", "clip"].includes(style.overflowY) &&
                  current.scrollHeight > current.clientHeight + 1) ||
                (["hidden", "clip"].includes(style.overflowX) &&
                  current.scrollWidth > current.clientWidth + 1)
              )
                visible = false;
            }
          }
          return {
            overflow: document.documentElement.scrollWidth > innerWidth + 1,
            visible: visible,
          };
        });
        checks.push({
          key: `viewport:${item.path}:${width}`,
          outcome:
            response?.status() === 200 && !result.overflow && result.visible
              ? "pass"
              : "fail",
          details:
            "Route returns 200, preserved content is visible and the page fits the viewport.",
        });
      }
    }
    for (const redirect of content.redirects) {
      const response = await context.request.get(
        origin + content.basePath + redirect.path + "/",
        { maxRedirects: 0 },
      );
      checks.push({
        key: `redirect:${redirect.path}`,
        outcome:
          response.status() === 308 &&
          response.headers().location ===
            content.basePath +
              (redirect.target === "/" ? "/" : redirect.target + "/")
            ? "pass"
            : "fail",
        details:
          "The approved redirect returns 308 to its exact rendered target.",
      });
    }
    const unknown = await page.goto(
      origin + content.basePath + "/definitely-not-a-blueprint-route/",
    );
    checks.push({
      key: "unknown_route",
      outcome: unknown?.status() === 404 ? "pass" : "fail",
      details: "Unknown routes return a real 404.",
    });
    await page.goto(origin + content.basePath + "/");
    await page.keyboard.press("Tab");
    const skip = await page.evaluate(
      () => document.activeElement?.textContent === "Skip to main content",
    );
    await page.keyboard.press("Enter");
    const mainFocused = await page.evaluate(
      () => document.activeElement?.id === "main-content",
    );
    await page.getByLabel("Your name").focus();
    const names: string[] = [];
    for (let step = 0; step < 4; step++) {
      names.push(
        await page.evaluate(
          () =>
            document.activeElement?.getAttribute("name") ||
            document.activeElement?.tagName ||
            "",
        ),
      );
      await page.keyboard.press("Tab");
    }
    checks.push({
      key: "keyboard",
      outcome:
        skip && mainFocused && names.join(",") === "name,email,message,BUTTON"
          ? "pass"
          : "fail",
      details:
        "The skip link works and enquiry fields/button follow keyboard order. This does not establish full accessibility compliance.",
    });
    const invalid = await context.request.post(
      origin + content.enquiryEndpoint,
      {
        data: {
          requestKey: crypto.randomUUID(),
          name: "Invalid",
          email: "not-an-email",
          message: "Short",
        },
      },
    );
    checks.push({
      key: "enquiry_validation",
      outcome: invalid.status() === 400 ? "pass" : "fail",
      details: "The backend rejects an invalid email before saving an enquiry.",
    });
    await page.getByLabel("Your name").fill("Verification visitor");
    await page.getByLabel("Email address").fill("verification@example.com");
    const submitted = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === content.enquiryEndpoint &&
        response.request().method() === "POST",
    );
    await page
      .getByLabel("Your message")
      .fill("Exact-build verification enquiry.");
    await page
      .getByRole("button", { name: "Submit enquiry", exact: true })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "Your enquiry was saved to the project inbox." })
      .waitFor({ timeout: 15000 });
    const first = await submitted;
    const replay = await context.request.post(
      origin + content.enquiryEndpoint,
      { data: first.request().postDataJSON() },
    );
    checks.push({
      key: "enquiry_idempotency",
      outcome:
        replay.status() === 201 &&
        JSON.stringify(await replay.json()) ===
          JSON.stringify(await first.json())
          ? "pass"
          : "fail",
      details:
        "Retrying the same submission returns the original saved enquiry.",
    });
    checks.push({
      key: "enquiry_backend",
      outcome: "pass",
      details:
        "The generated form saved a validated test enquiry through the project backend.",
    });
    checks.push({
      key: "browser_runtime",
      outcome: errors.length ? "fail" : "pass",
      details: errors.length
        ? "Browser runtime errors occurred."
        : "No browser runtime errors.",
    });
  } catch {
    checks.push({
      key: "browser_verification",
      outcome: "inconclusive",
      details:
        "Required browser/feature verification could not finish; completion is blocked.",
    });
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  return {
    suiteVersion: "website-preview-v2",
    environment: "isolated_local_preview",
    passed: checks.every((check) => check.outcome === "pass"),
    buildId: manifest.buildId,
    sealSha256: seal,
    checks,
    browserVersion,
    testedAt: new Date().toISOString(),
    mode: manifest.inputs.mode,
  };
}
