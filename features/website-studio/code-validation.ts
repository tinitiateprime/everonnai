import { parseFragment, serialize, type DefaultTreeAdapterMap } from "parse5";
import * as cssTree from "css-tree";
import type { BusinessProfile, WebsiteCodeConcept, WebsiteCodePage, WebsiteSpec } from "@/features/everonn/types";
import type { WebsitePreferences } from "@/features/agent-runtime/types";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
const tags = new Set("a abbr address article aside b blockquote br button caption cite code col colgroup dd details div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hr i img li main mark nav ol p pre s section small span strong sub summary sup table tbody td th thead time tr u ul".split(" "));
const attributes = new Set("class id title role href src alt width height loading decoding target rel type open colspan rowspan scope datetime aria-label aria-hidden aria-labelledby aria-describedby aria-expanded aria-controls aria-current data-everonn-action data-service-id data-section".split(" "));
const cssFunctions = new Set("var calc min max clamp rgb rgba hsl hsla hwb lab lch oklab oklch color color-mix light-dark linear-gradient radial-gradient conic-gradient repeating-linear-gradient repeating-radial-gradient repeating-conic-gradient repeat minmax fit-content cubic-bezier steps translate translateX translateY translateZ translate3d scale scaleX scaleY scaleZ scale3d rotate rotateX rotateY rotateZ rotate3d skew skewX skewY perspective matrix matrix3d blur brightness contrast grayscale hue-rotate invert opacity saturate sepia drop-shadow counter counters".toLowerCase().split(" "));

function fail(message: string): never { throw new Error(`Website code validation: ${message}`); }
function bounded(value: unknown, name: string, maximum: number) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) fail(`${name} is missing or exceeds ${maximum} characters.`);
  return value.trim();
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Expected an object.");
  return value as Record<string, unknown>;
}
function decoded(value: string) { return value.replace(/\\([0-9a-f]{1,6})\s?|\\(.)/gi, (_, hex, literal) => hex ? String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)) : literal).toLowerCase(); }

export function websitePaths(spec: WebsiteSpec) {
  return ["/", "/services", ...spec.services.map((service) => `/services/${service.slug}`), "/about", "/contact"];
}

export function websiteAssets(spec: WebsiteSpec) {
  return Object.fromEntries([
    ...(spec.media.hero ? [["asset:hero", spec.media.hero]] : []),
    ...(spec.media.story ? [["asset:story", spec.media.story]] : []),
    ...spec.media.gallery.map((asset, index) => [`asset:gallery:${index}`, asset]),
    ...Object.entries(spec.media.services).map(([id, asset]) => [`asset:service:${id}`, asset]),
  ]) as Record<string, NonNullable<WebsiteSpec["media"]["hero"]>>;
}

function elements(node: Node, visit: (element: Element) => void) {
  if ("tagName" in node) visit(node);
  if ("childNodes" in node) for (const child of node.childNodes) elements(child, visit);
}
function textContent(node: Node): string {
  if ("value" in node) return node.value;
  return "childNodes" in node ? node.childNodes.map(textContent).join(" ") : "";
}
const phoneHref = (profile: BusinessProfile) => `tel:${profile.phone.replace(/[^+\d]/g, "")}`;

function allowedHref(href: string, spec: WebsiteSpec, profile: BusinessProfile) {
  if (["action:booking", "action:chat", "action:voice"].includes(href)) return true;
  if (/^#[a-z][a-z0-9_-]*$/i.test(href)) return true;
  const [path, fragment, ...extra] = href.split("#");
  if (!extra.length && websitePaths(spec).includes(path) && (!fragment || /^[a-z][a-z0-9_-]*$/i.test(fragment))) return true;
  if (profile.phone && href === phoneHref(profile)) return true;
  if (profile.email && href.toLowerCase() === `mailto:${profile.email.toLowerCase()}`) return true;
  const external = [profile.website, "https://www.pexels.com", "https://www.pexels.com/", ...Object.values(websiteAssets(spec)).map((asset) => asset.sourceUrl)].filter(Boolean);
  return href.startsWith("https://") && external.includes(href);
}

export function validateWebsiteHtml(source: string, spec: WebsiteSpec, profile: BusinessProfile, path: string, preferences?: WebsitePreferences) {
  if (/<\/?(?:html|head|body)\b|<!doctype/i.test(source)) fail("Return an HTML body fragment, not a full document.");
  const fragment = parseFragment(bounded(source, "page HTML", 55_000));
  const assets = websiteAssets(spec);
  const ids = new Set<string>();
  const links: string[] = [];
  let h1 = 0, main = 0, navigation = 0, actions = 0, nodes = 0;
  elements(fragment, (element) => {
    if (++nodes > 1800) fail("Too many page elements.");
    if (element.namespaceURI !== "http://www.w3.org/1999/xhtml" || !tags.has(element.tagName)) fail(`Element ${element.tagName} is not permitted. Use semantic HTML and native details/summary.`);
    for (const attr of element.attrs) {
      if (attr.namespace || !attributes.has(attr.name)) fail(`Attribute ${attr.name} is not permitted. Inline styles and scripts are not allowed.`);
      if (attr.value.length > 2000) fail("An attribute is too long.");
    }
    const attr = (name: string) => element.attrs.find((item) => item.name === name)?.value;
    const id = attr("id");
    if (id) {
      if (!/^[a-z][a-z0-9_-]{0,70}$/i.test(id) || id === "everonn-generated-site" || ids.has(id)) fail("Page IDs must be valid and unique.");
      ids.add(id);
    }
    if (element.tagName === "h1") h1++;
    if (element.tagName === "main") main++;
    if (element.tagName === "nav") navigation++;
    if (element.tagName === "a") {
      const href = attr("href");
      if (!href || !allowedHref(href, spec, profile)) fail(`Unsupported link ${href || "(missing)"}. Use only supplied routes, contacts, assets, and platform actions.`);
      links.push(href);
      if (href.startsWith("action:")) actions++;
      if (href.startsWith("https://")) {
        element.attrs = element.attrs.filter((item) => !["target", "rel"].includes(item.name));
        element.attrs.push({ name: "target", value: "_blank" }, { name: "rel", value: "noopener noreferrer" });
      } else element.attrs = element.attrs.filter((item) => !["target", "rel"].includes(item.name));
    } else if (attr("href") || attr("target")) fail("Links belong on anchors only.");
    if (element.tagName === "button") {
      if (!["booking", "chat", "voice"].includes(attr("data-everonn-action") || "")) fail("Buttons need a supported platform action; use details/summary for menus and FAQs.");
      element.attrs = element.attrs.filter((item) => item.name !== "type");
      element.attrs.push({ name: "type", value: "button" });
      actions++;
    }
    if (element.tagName === "img") {
      const asset = assets[attr("src") || ""] || Object.values(assets).find((item) => item.url === attr("src"));
      if (!asset || preferences?.imagery === "none") fail("Images must use a supplied approved asset; no invented or remote image URLs.");
      if (attr("alt") === undefined) fail("Every image needs alt text.");
      if (asset.id === spec.media.hero?.id) {
        element.attrs = element.attrs.filter((item) => item.name !== "loading");
        element.attrs.push({ name: "loading", value: "eager" });
      } else if (!element.attrs.some((item) => item.name === "loading")) element.attrs.push({ name: "loading", value: "lazy" });
      element.attrs = element.attrs.filter((item) => item.name !== "decoding");
      element.attrs.push({ name: "decoding", value: "async" });
    } else if (attr("src")) fail("Only images can load assets.");
    const serviceId = attr("data-service-id");
    if (serviceId && !spec.services.some((service) => service.id === serviceId)) fail("A section references an unoffered service.");
    if (path === "/" && preferences?.hiddenSections.includes(attr("data-section") as NonNullable<WebsitePreferences>["hiddenSections"][number])) fail("An owner-hidden homepage section is present.");
  });
  const structureProblems = [
    ...(main !== 1 ? [`Use exactly one <main> element; found ${main}.`] : []),
    ...(h1 !== 1 ? [`Use exactly one <h1> element; found ${h1}.`] : []),
    ...(!navigation ? ["Add a <nav> element with the required site links."] : []),
    ...(!actions ? ['Add a working platform CTA using an anchor with href="action:booking", href="action:chat", or href="action:voice".'] : []),
  ];
  if (structureProblems.length) fail(`Page ${path}: ${structureProblems.join(" ")}`);
  for (const required of ["/", "/services", "/about", "/contact"]) if (!links.includes(required)) fail(`Navigation must include ${required}.`);
  for (const href of links.filter((item) => item.startsWith("#"))) if (!ids.has(href.slice(1))) fail(`Broken anchor ${href}.`);
  const content = textContent(fragment).replace(/\s+/g, " ");
  const normalizedContent = content.toLowerCase();
  if (content.length < 180) fail("The page needs useful complete content.");
  if (/lorem ipsum|\btbd\b|coming soon|placeholder/i.test(content)) fail("Placeholder content is not allowed.");
  if (!normalizedContent.includes(profile.businessName.toLowerCase())) fail("The business identity is missing.");
  if (path === "/services") for (const service of spec.services) {
    if (!links.includes(`/services/${service.slug}`) || !normalizedContent.includes(service.name.toLowerCase())) fail(`The services index must link to ${service.name}.`);
  }
  const service = spec.services.find((item) => path === `/services/${item.slug}`);
  if (service && !normalizedContent.includes(service.name.toLowerCase()) && !normalizedContent.includes(service.pageHeadline.toLowerCase())) fail(`The service detail page ${path} must identify the active service using its name or approved headline.`);
  if (path === "/contact" && !links.some((href) => href === phoneHref(profile) || href === `mailto:${profile.email}`)) fail("The contact page needs a verified phone or email link.");
  if (preferences?.priorityServiceId && path === "/") {
    const serviceLinks = links.filter((href) => href.startsWith("/services/"));
    const priority = spec.services.find((item) => item.id === preferences.priorityServiceId);
    if (priority && serviceLinks[0] !== `/services/${priority.slug}`) fail("The owner's priority service must appear first on the homepage.");
  }
  return { html: serialize(fragment), text: content };
}

function checkedCss(source: string, complete: boolean) {
  bounded(source, "CSS", 40_000);
  if (source.includes("<")) fail("CSS cannot contain HTML delimiters.");
  const ast = cssTree.parse(source, { parseCustomProperty: true, onParseError(error) { fail(`Invalid CSS: ${error.message}`); } });
  let declarations = 0;
  cssTree.walk(ast, (node) => {
    if (node.type === "Raw" || node.type === "Url") fail("CSS must be parseable and cannot load external resources.");
    if (node.type === "Function" && !cssFunctions.has(decoded(node.name))) fail(`Unsupported CSS function ${node.name}.`);
    if (node.type === "Atrule" && !["media", "supports", "container", "keyframes"].includes(decoded(node.name))) fail(`Unsupported CSS rule @${node.name}.`);
    if (node.type === "Declaration") {
      if (++declarations > 2500 || ["behavior", "-moz-binding"].includes(decoded(node.property))) fail("Unsupported CSS declaration.");
    }
    if (node.type === "PseudoClassSelector" && ["host", "host-context", "global"].includes(decoded(node.name))) fail("CSS must target this website only.");
    if (node.type === "NestingSelector") fail("Expand nested CSS selectors.");
  });
  if (complete && (declarations < 8 || !/@media/i.test(source))) fail("Provide a complete responsive stylesheet with mobile media queries.");
  return cssTree.generate(ast);
}

export function validateWebsiteCss(source: string) { return checkedCss(source, true); }

export function scopeWebsiteCss(source: string, concept: string) {
  const ast = cssTree.parse(validateWebsiteCss(source), { parseCustomProperty: true });
  const animations = new Map<string, string>();
  cssTree.walk(ast, (node) => {
    if (node.type === "Atrule" && decoded(node.name) === "keyframes") {
      const name = node.prelude && cssTree.generate(node.prelude);
      if (!name || !/^[a-z][a-z0-9_-]*$/i.test(name)) fail("Keyframes need a simple name.");
      const scoped = `everonn-${concept}-${name}`;
      animations.set(name, scoped);
      node.prelude = cssTree.parse(scoped, { context: "atrulePrelude" }) as cssTree.AtrulePrelude;
    }
  });
  let inKeyframes = 0;
  cssTree.walk(ast, {
    enter(node: cssTree.CssNode) {
      if (node.type === "Atrule" && decoded(node.name) === "keyframes") inKeyframes++;
      if (node.type === "Rule" && !inKeyframes) {
        if (node.prelude.type !== "SelectorList") fail("Invalid CSS selector.");
        node.prelude.children.forEach((selector, item, list) => {
          const original = cssTree.generate(selector);
          const rooted = original.replace(/:root\b/g, ".site").replace(/(^|[\s>+~])(?:html|body)(?=$|[\s>+~.#[:])/gi, "$1.site");
          // Every selector has a descendant prefix, including sibling combinators.
          const scoped = `#everonn-generated-site ${rooted}`;
          list.replace(item, cssTree.List.createItem(cssTree.parse(scoped, { context: "selector" }) as cssTree.Selector));
        });
      }
      if (node.type === "Declaration" && ["animation", "animation-name"].includes(decoded(node.property))) cssTree.walk(node.value, (value) => {
        if (value.type === "Identifier" && animations.has(value.name)) value.name = animations.get(value.name)!;
      });
    },
    leave(node: cssTree.CssNode) { if (node.type === "Atrule" && decoded(node.name) === "keyframes") inKeyframes--; },
  });
  return cssTree.generate(ast);
}

function extractInlineCss(source: string, pageIndex: number) {
  if (/<\/?(?:html|head|body)\b|<!doctype/i.test(source)) fail("Return an HTML body fragment, not a full document.");
  const fragment = parseFragment(bounded(source, "page HTML", 55_000));
  const rules: string[] = [];
  elements(fragment, (element) => {
    const style = element.attrs.find((attr) => attr.name === "style");
    if (!style) return;
    if (style.value.length > 2000 || style.value.includes("<")) fail("Inline CSS exceeds limits or contains HTML.");
    element.attrs = element.attrs.filter((attr) => attr.name !== "style");
    if (!style.value.trim()) return;
    const declarations = cssTree.parse(style.value, { context: "declarationList", parseCustomProperty: true, onParseError(error) { fail(`Invalid inline CSS: ${error.message}`); } }) as cssTree.DeclarationList;
    declarations.children.forEach((node) => { if (node.type !== "Declaration") fail("Inline CSS must contain declarations only."); });
    const className = `everonn-declaration-${pageIndex}-${rules.length}`;
    // Apply the stylesheet's execution/resource guards, then remove the attribute.
    const rule = checkedCss(`.${className}{${cssTree.generate(declarations)}}`, false);
    rules.push(rule);
    const classAttr = element.attrs.find((attr) => attr.name === "class");
    if (classAttr) classAttr.value += ` ${className}`;
    else element.attrs.push({ name: "class", value: className });
  });
  return { html: serialize(fragment), css: rules.join("") };
}

export function normalizeWebsiteCodeConcept(value: unknown, spec: WebsiteSpec, profile: BusinessProfile, preferences?: WebsitePreferences): WebsiteCodeConcept {
  return normalizeWebsiteCodeBatch(value, spec, profile, websitePaths(spec), preferences);
}

export function normalizeWebsiteCodeBatch(value: unknown, spec: WebsiteSpec, profile: BusinessProfile, requiredPaths: string[], preferences?: WebsitePreferences): WebsiteCodeConcept {
  const input = record(value);
  if (!requiredPaths.length || new Set(requiredPaths).size !== requiredPaths.length || requiredPaths.some((path) => !websitePaths(spec).includes(path))) fail("Invalid page batch routes.");
  if (!Array.isArray(input.pages) || input.pages.length !== requiredPaths.length) fail(`Generate every required page, without extra routes. Expected routes: ${requiredPaths.join(", ")}.`);
  const seen = new Set<string>();
  const extractedStyles: string[] = [];
  const pages: WebsiteCodePage[] = input.pages.map((value, index) => {
    const page = record(value);
    const path = bounded(page.path, `page ${index + 1} path (${typeof page.path})`, 150);
    if (!requiredPaths.includes(path) || seen.has(path)) fail(`Unexpected or duplicate page ${path}.`);
    seen.add(path);
    const extracted = extractInlineCss(bounded(page.html, "page HTML", 55_000), websitePaths(spec).indexOf(path));
    extractedStyles.push(extracted.css);
    return { path, title: bounded(page.title, "page title", 180), description: bounded(page.description, "page description", 350), html: validateWebsiteHtml(extracted.html, spec, profile, path, preferences).html };
  });
  const css = validateWebsiteCss(`${bounded(input.css, "CSS", 40_000)}${extractedStyles.join("")}`);
  if (!css.includes("var(--brand-primary)") || !css.includes("var(--brand-accent)")) fail("Use the supplied brand color variables in the design.");
  return { name: bounded(input.name, "concept name", 100), rationale: bounded(input.rationale, "design rationale", 1200), css, pages };
}

export function prepareWebsitePage(page: WebsiteCodePage, css: string, spec: WebsiteSpec, profile: BusinessProfile, concept: string, basePath: string, preview: boolean) {
  const checked = validateWebsiteHtml(page.html, spec, profile, page.path);
  const fragment = parseFragment(checked.html);
  const assets = websiteAssets(spec);
  elements(fragment, (element) => {
    for (const attr of element.attrs) {
      if (attr.name === "src" && assets[attr.value]) attr.value = assets[attr.value].url;
      if (attr.name === "href" && attr.value.startsWith("/")) {
        const [path, hash] = attr.value.split("#");
        attr.value = `${basePath}${path === "/" ? "" : path}${preview ? `?theme=${concept}` : ""}${hash ? `#${hash}` : ""}`;
      }
      if (attr.name === "href" && attr.value.startsWith("action:")) {
        element.attrs.push({ name: "data-everonn-action", value: attr.value.slice(7) });
        attr.value = "#everonn-request";
      }
    }
  });
  return { html: serialize(fragment), css: scopeWebsiteCss(css, concept) };
}
