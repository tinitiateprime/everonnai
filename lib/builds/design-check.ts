import { chromium } from "playwright";
import { baseCss } from "./compiler";
import type { Design, DesignBrief } from "./design";

// Design-time layout check: renders a design against the business's real home-page
// title/headings/navigation in the same markup the compiler emits, and measures the
// failures CSS can introduce without overflowing (e.g. a headline squeezed into a narrow
// column). The compiled-build verification still runs its own exact-build checks.
const escape = (text: string) =>
  text.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );
export function designPreviewHtml(
  design: Design,
  businessName: string,
  brief: DesignBrief,
) {
  const home = brief.pages.find((page) => page.path === "/") ?? brief.pages[0];
  const nav = brief.pages.slice(0, 8).map((page) => page.title);
  const text = home?.excerpt || "Approved page content.";
  const links = nav.map((title) => `<a href="#">${escape(title)}</a>`).join("");
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${baseCss}\n${design.css}</style></head><body><div class="site-shell layout-${design.navigation} content-${design.content}"><a class="skip-link" href="#main-content">Skip to main content</a><header class="site-header"><a class="brand" href="#">${escape(businessName)}</a><nav class="site-nav" aria-label="Website navigation">${links}</nav></header><div><main id="main-content"><section class="hero ${design.hero}"><div class="hero-copy"><h1 class="hero-title">${escape(home?.title || businessName)}</h1><p>${escape(businessName)}</p></div>${design.hero === "split" ? `<div class="business-facts"><p>${escape(businessName)}</p></div>` : ""}</section><article class="page-body family-home"><div class="page-headings">${(
    home?.headings ?? []
  )
    .slice(0, 4)
    .map((h) => `<h2>${escape(h)}</h2>`)
    .join(
      "",
    )}</div><div class="source-content" data-source-content><p class="source-paragraph">${escape(text)}</p><p class="source-paragraph">${escape(text)}</p></div></article><aside class="business-facts" aria-label="Approved business details"><p><strong>Business name: </strong><span>${escape(businessName)}</span></p></aside><section class="page-directory"><h2>Explore our website</h2><nav aria-label="All website pages"><ul>${nav.map((title) => `<li><a href="#">${escape(title)}</a></li>`).join("")}</ul></nav></section><section class="enquiry"><h2>Send an enquiry</h2><form aria-label="Enquiry form"><label>Your name<input name="name"></label><label>Email address<input name="email" type="email"></label><label>Your message<textarea name="message"></textarea></label><button type="submit">Submit enquiry</button></form></section></main><footer class="site-footer">${escape(businessName)}</footer></div></div></body></html>`;
}

type Box = {
  width: number;
  height: number;
  visible: boolean;
  lineHeight: number;
  fontSize: number;
} | null;
type Measurements = {
  overflow: number;
  title: Box;
  content: Box;
  brand: Box;
  nav: Box;
  body: number;
};
// Plain source text: evaluated in the page as-is, so build tools cannot inject helpers.
const MEASURE = `(() => {
  const box = (selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const r = el.getBoundingClientRect(), style = getComputedStyle(el);
    return {
      width: r.width,
      height: r.height,
      visible: r.width > 0 && r.height > 0 && style.visibility !== "hidden" &&
        style.display !== "none" && Number(style.opacity) > 0.05,
      lineHeight: parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2,
      fontSize: parseFloat(style.fontSize),
    };
  };
  return {
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    title: box(".hero-title"),
    content: box(".source-content"),
    brand: box(".brand"),
    nav: box(".site-nav"),
    body: parseFloat(getComputedStyle(document.body).fontSize),
  };
})()`;
/** Returns concrete layout problems; empty when the design passes. Null when Chromium is unavailable. */
export async function checkDesignLayout(
  design: Design,
  businessName: string,
  brief: DesignBrief,
): Promise<string[] | null> {
  const browser = await chromium
    .launch({
      headless: true,
      ...(process.env.CHROMIUM_EXECUTABLE_PATH
        ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH }
        : {}),
    })
    .catch(() => null);
  if (!browser) return null;
  const problems: string[] = [];
  try {
    const context = await browser.newContext({ javaScriptEnabled: false });
    // No network: the design must not depend on external resources.
    await context.route("**/*", (route) => route.abort());
    const page = await context.newPage();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.setContent(designPreviewHtml(design, businessName, brief), {
        waitUntil: "domcontentloaded",
      });
      const m = (await page.evaluate(MEASURE)) as Measurements;
      const where = `at ${width}px`;
      if (m.overflow > 2)
        problems.push(
          `The page scrolls horizontally by ${Math.round(m.overflow)}px ${where}.`,
        );
      const minimum = width >= 1000 ? 360 : 240;
      if (!m.title?.visible)
        problems.push(`The hero title is not visible ${where}.`);
      else {
        if (m.title.width < minimum)
          problems.push(
            `The hero title (.hero-title) is squeezed to ${Math.round(m.title.width)}px wide ${where}; give it at least ${minimum}px so words are not broken.`,
          );
        const lines = m.title.height / m.title.lineHeight;
        if (lines > (width >= 1000 ? 6 : 9))
          problems.push(
            `The hero title wraps onto about ${Math.round(lines)} lines ${where}; reduce its size or widen its column.`,
          );
      }
      if (!m.content?.visible || m.content.width < (width >= 1000 ? 320 : 240))
        problems.push(
          `The main content (.source-content) is ${m.content ? Math.round(m.content.width) + "px wide" : "missing"} ${where}; it must be readable.`,
        );
      if (!m.brand?.visible)
        problems.push(`The brand is not visible ${where}.`);
      if (!m.nav?.visible)
        problems.push(`The navigation is not visible ${where}.`);
      if (m.body < 15)
        problems.push(`Body text is ${m.body}px ${where}; use at least 16px.`);
    }
  } finally {
    await browser.close();
  }
  return problems;
}
