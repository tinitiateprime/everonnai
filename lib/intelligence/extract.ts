import { load } from "cheerio";
import type { Element } from "domhandler";
import * as cssTree from "css-tree";
import { digest } from "../storage/artifacts";
import type {
  Finding,
  Feature,
  PageInventory,
  Reference,
  SourceAsset,
  Token,
} from "./contracts";
const clean = (value: string) => value.replace(/\s+/g, " ").trim();
export const referenceId = (captureId: string, key: string) =>
  `${captureId}:${digest(Buffer.from(key)).slice(0, 16)}`;
export function cssTokens(
  css: string,
  origin: string,
): { tokens: Token[]; limits: string[] } {
  const tokens: Token[] = [],
    limits: string[] = [];
  try {
    const tree = cssTree.parse(css, {
      parseCustomProperty: true,
      onParseError: () => {
        if (!limits.length)
          limits.push(
            "Some source CSS could not be parsed; computed browser styles supplement the stylesheet inventory.",
          );
      },
    });
    cssTree.walk(tree, (node) => {
      if (node.type === "Atrule" && node.name.toLowerCase() === "media")
        tokens.push({
          kind: "breakpoint",
          name: "media",
          value: node.prelude
            ? cssTree.generate(node.prelude).slice(0, 500)
            : "",
          count: 1,
          origin,
        });
      if (node.type !== "Declaration") return;
      const property = cssTree.ident.decode(node.property).toLowerCase(),
        value = cssTree.generate(node.value).slice(0, 1000);
      const kind: Token["kind"] | null = property.startsWith("--")
        ? "custom_property"
        : property === "font-family"
          ? "font"
          : property === "font-size"
            ? "font_size"
            : /^(color|background|border.*color|fill|stroke)$/.test(property)
              ? "color"
              : /^(margin|padding|gap|row-gap|column-gap|line-height)/.test(
                    property,
                  )
                ? "spacing"
                : property.includes("radius")
                  ? "radius"
                  : property.includes("shadow")
                    ? "shadow"
                    : /^(display|grid-template|flex-direction|align-items|justify-content)/.test(
                          property,
                        )
                      ? "layout"
                      : null;
      if (kind) tokens.push({ kind, name: property, value, count: 1, origin });
    });
  } catch {
    limits.push(
      "The source stylesheet could not be fully parsed. This does not prove invalid CSS in the website.",
    );
  }
  if (tokens.length > 3000)
    limits.push(
      `Stylesheet token inventory contains ${tokens.length} declarations; the first 3,000 are retained.`,
    );
  return { tokens: tokens.slice(0, 3000), limits };
}
export function inspectHtml(
  html: string,
  url: string,
  captureId: string,
  origin: "captured_html" | "browser" = "captured_html",
): { inventory: PageInventory; references: Reference[]; findings: Finding[] } {
  const $ = load(html),
    limits: string[] = [],
    references: Reference[] = [],
    findings: Finding[] = [];
  const absolute = (value: string | undefined) => {
    try {
      return value ? new URL(value, url).href : "";
    } catch {
      return "";
    }
  };
  const locator = (el: Parameters<typeof $>[0]) => {
    const node = $(el);
    if (node.attr("id")) return `#${node.attr("id")!.slice(0, 150)}`;
    const path: string[] = [];
    let current = node;
    for (let i = 0; i < 6 && current.length; i++) {
      const name = current.prop("tagName")?.toLowerCase() || "element";
      path.unshift(`${name}:nth-of-type(${current.prevAll(name).length + 1})`);
      current = current.parent();
    }
    return path.join(" > ");
  };
  const elements = (selector: string, max: number) => {
    const all = $(selector)
      .toArray()
      .filter((node): node is Element => "tagName" in node);
    if (all.length > max)
      limits.push(
        `${selector}: ${all.length} items exist; ${max} retained in the structured inventory. Full captured HTML remains available.`,
      );
    return all.slice(0, max);
  };
  const ref = (key: string, where: string, observation: string) => {
    const id = referenceId(captureId, origin + ":" + key);
    if (!references.some((item) => item.id === id))
      references.push({
        id,
        captureId,
        url,
        locator: where,
        observation: observation.slice(0, 800),
        kind: origin,
      });
    return id;
  };
  const issue = (
    rule: string,
    area: Finding["area"],
    priority: Finding["priority"],
    title: string,
    detail: string,
    where: string,
    observation: string,
    action: string,
    acceptance: string[],
    kind: Finding["kind"] = "observed",
  ) => {
    const evidence = ref(rule + ":" + where, where, observation);
    findings.push({
      id: referenceId(captureId, "finding:" + rule + where),
      rule,
      area,
      priority,
      kind,
      title,
      detail,
      evidenceIds: [evidence],
      action,
      acceptance,
    });
  };
  const assets: SourceAsset[] = [];
  const addAsset = (
    kind: SourceAsset["kind"],
    src: string | undefined,
    where: string,
    alt: string | null,
    details: SourceAsset["details"] = {},
  ) => {
    const target = absolute(src);
    if (target && /^https?:/.test(target))
      assets.push({ kind, url: target, locator: where, alt, details });
  };
  const headings = elements("h1,h2,h3,h4,h5,h6", 3000).map((el) => ({
    level: Number(el.tagName.slice(1)),
    text: clean($(el).text()).slice(0, 4000),
    locator: locator(el),
  }));
  const links = elements("a[href]", 12000)
    .map((el) => {
      const target = absolute($(el).attr("href"));
      let internal = false,
        fragment: string | null = null;
      try {
        const parsed = new URL(target);
        internal = parsed.origin === new URL(url).origin;
        fragment = parsed.hash || null;
      } catch {
        /* Malformed links remain external/unclassified observations. */
      }
      return {
        url: target,
        text: clean($(el).attr("aria-label") || $(el).text()).slice(0, 1000),
        locator: locator(el),
        rel: $(el).attr("rel") || "",
        internal,
        fragment,
      };
    })
    .filter((item) => item.url);
  const forms = elements("form", 400).map((el) => {
    const form = $(el),
      formName = clean(
        form.attr("aria-label") ||
          form.attr("name") ||
          form.find("legend,h2,h3").first().text(),
      ).slice(0, 200);
    const fields = form
      .find(
        "input:not([type=hidden]):not([type=submit]):not([type=button]),textarea,select",
      )
      .toArray()
      .slice(0, 1000)
      .map((field) => {
        const node = $(field),
          id = node.attr("id"),
          explicit = id
            ? $("label")
                .filter((_, label) => $(label).attr("for") === id)
                .text()
            : "",
          label = clean(
            node.attr("aria-label") ||
              explicit ||
              node.closest("label").clone().children().remove().end().text(),
          ).slice(0, 400);
        return {
          tag: field.tagName,
          type:
            node.attr("type") ||
            (field.tagName === "input" ? "text" : field.tagName),
          name: (node.attr("name") || "").slice(0, 200),
          label,
          required: node.is("[required],[aria-required=true]"),
          options: node
            .find("option")
            .toArray()
            .slice(0, 100)
            .map((option) => clean($(option).text()).slice(0, 200)),
          autocomplete: node.attr("autocomplete") || "",
          pattern: (node.attr("pattern") || "").slice(0, 300),
        };
      });
    return {
      locator: locator(el),
      label: formName,
      method: (form.attr("method") || "GET").toUpperCase(),
      action: absolute(form.attr("action") || url),
      fields,
      submitLabels: form
        .find("button:not([type=button]),input[type=submit]")
        .toArray()
        .map((button) =>
          clean($(button).text() || $(button).attr("value") || "Submit").slice(
            0,
            200,
          ),
        ),
    };
  });
  const features: Feature[] = [];
  const feature = (
    kind: string,
    label: string,
    where: string,
    details: Feature["details"],
    confidence: Feature["confidence"] = "observed",
    backend: Feature["backend"] = "not_tested",
  ) => {
    const evidence = ref(
      "feature:" + kind + where,
      where,
      `${label}: ${JSON.stringify(details)}`,
    );
    features.push({
      id: referenceId(captureId, "feature:" + kind + where),
      kind,
      label,
      locator: where,
      confidence,
      backend,
      details,
      evidenceIds: [evidence],
    });
  };
  for (const form of forms) {
    const text = clean(
      form.label +
        " " +
        form.submitLabels.join(" ") +
        " " +
        form.fields
          .map((field) => field.label + " " + field.name + " " + field.type)
          .join(" "),
    );
    let kind = "form",
      confidence: Feature["confidence"] = "observed";
    if (
      form.fields.some((field) => field.type === "search") ||
      /\bsearch\b/i.test(text)
    )
      kind = "search";
    else if (form.fields.some((field) => field.type === "password"))
      kind = "account";
    else if (/book|appointment|schedule|reserve/i.test(text)) {
      kind = "booking";
      confidence = "inferred";
    } else if (/subscribe|newsletter/i.test(text)) {
      kind = "newsletter";
      confidence = "inferred";
    } else if (/contact|enquir|message|request|callback/i.test(text)) {
      kind = "enquiry";
      confidence = "inferred";
    }
    feature(
      kind,
      form.label || `${kind} form`,
      form.locator,
      {
        method: form.method,
        action: form.action,
        fieldCount: form.fields.length,
        requiredFields: form.fields.filter((field) => field.required).length,
        fieldNames: form.fields.map((field) => field.name || field.type),
      },
      confidence,
    );
    if (form.fields.some((field) => !field.label))
      issue(
        "form_labels",
        "accessibility",
        "P1",
        "Review unlabeled form fields",
        "Some fields have no explicit or wrapping label/aria-label in the captured markup. aria-labelledby and browser accessibility findings may provide additional evidence.",
        form.locator,
        `${form.fields.filter((field) => !field.label).length} fields have no extracted label`,
        "Provide clear programmatic labels and confirm accessible names in the browser.",
        ["Every field has an accessible name and clear instructions."],
        "inferred",
      );
    if (!form.submitLabels.length)
      issue(
        "form_submit",
        "features",
        "P2",
        "Confirm how this form is submitted",
        "No native submit control was found. JavaScript or implicit Enter submission may exist.",
        form.locator,
        "No captured native submit control",
        "Confirm the intended submission interaction and preserve it in the upgrade.",
        ["Keyboard and pointer submission complete the supported workflow."],
        "inferred",
      );
  }
  for (const el of elements("img", 3000)) {
    const node = $(el),
      where = locator(el);
    addAsset(
      "image",
      node.attr("src") || node.attr("data-src"),
      where,
      node.attr("alt") ?? null,
      {
        loading: node.attr("loading") || "",
        width: node.attr("width") || "",
        height: node.attr("height") || "",
      },
    );
    for (const entry of (node.attr("srcset") || "").split(","))
      addAsset(
        "image",
        entry.trim().split(/\s+/)[0],
        where,
        node.attr("alt") ?? null,
        { source: "srcset" },
      );
    if (!node.is("[alt]"))
      issue(
        "image_alt",
        "accessibility",
        "P2",
        "An image has no alt attribute",
        "Its purpose must be reviewed to choose meaningful alternate text or an intentional empty alt attribute.",
        where,
        `Image: ${node.attr("src") || node.attr("data-src") || "unknown"}`,
        "Describe informative images; mark decorative images intentionally.",
        [
          "Every image has context-appropriate alt handling confirmed by review.",
        ],
      );
  }
  for (const el of elements("picture source[srcset]", 2000))
    for (const entry of ($(el).attr("srcset") || "").split(","))
      addAsset("image", entry.trim().split(/\s+/)[0], locator(el), null, {
        source: "picture",
        media: $(el).attr("media") || "",
      });
  for (const el of elements("link[rel~=stylesheet]", 300))
    addAsset("stylesheet", $(el).attr("href"), locator(el), null);
  for (const el of elements("script[src]", 500))
    addAsset("script", $(el).attr("src"), locator(el), null);
  for (const el of elements("video,audio", 200)) {
    const node = $(el),
      kind = el.tagName as "video" | "audio";
    addAsset(kind, node.attr("src"), locator(el), null, {
      controls: node.is("[controls]"),
      autoplay: node.is("[autoplay]"),
    });
    for (const src of node.find("source").toArray())
      addAsset(kind, $(src).attr("src"), locator(src), null);
    if (kind === "video")
      addAsset("image", node.attr("poster"), locator(el), null, {
        source: "video poster",
      });
    feature(
      kind,
      `${kind} player`,
      locator(el),
      { controls: node.is("[controls]") },
      "observed",
      "not_applicable",
    );
  }
  for (const el of elements("iframe", 200)) {
    const node = $(el),
      src = absolute(node.attr("src"));
    addAsset(
      "iframe",
      node.attr("src"),
      locator(el),
      node.attr("title") ?? null,
    );
    let kind = "embedded_widget";
    if (/calendly|tidycal|acuityscheduling|cal\.com|bookings/i.test(src))
      kind = "booking";
    else if (/maps\.google|google\.[^/]+\/maps|openstreetmap|mapbox/i.test(src))
      kind = "map";
    else if (/youtube|vimeo/i.test(src)) kind = "video";
    feature(
      kind,
      node.attr("title") || "Embedded third-party widget",
      locator(el),
      { providerUrl: src },
      kind === "embedded_widget" ? "observed" : "inferred",
    );
  }
  for (const link of links) {
    if (/^mailto:/i.test(link.url))
      feature(
        "email_link",
        link.text || "Email contact",
        link.locator,
        { target: link.url },
        "observed",
        "not_applicable",
      );
    else if (/^tel:/i.test(link.url))
      feature(
        "phone_link",
        link.text || "Telephone contact",
        link.locator,
        { target: link.url },
        "observed",
        "not_applicable",
      );
    else if (/\.(pdf|docx?|xlsx?|zip)(\?|$)/i.test(link.url))
      addAsset("download", link.url, link.locator, link.text);
    else if (
      /\b(book|appointment|schedule|reserve|checkout|cart|login|sign in)\b/i.test(
        link.text,
      )
    ) {
      const kind = /checkout|cart/i.test(link.text)
        ? "commerce"
        : /login|sign in/i.test(link.text)
          ? "account"
          : "booking";
      feature(
        kind,
        link.text,
        link.locator,
        { entryUrl: link.url },
        "inferred",
      );
    }
  }
  for (const el of elements("nav,[role=navigation]", 100))
    feature(
      "navigation",
      $(el).attr("aria-label") || "Navigation",
      locator(el),
      { links: $(el).find("a[href]").length },
      "observed",
      "not_applicable",
    );
  for (const el of elements(
    "details,[role=tablist],[role=dialog],[aria-controls][aria-expanded]",
    500,
  )) {
    const node = $(el),
      kind =
        el.tagName === "details"
          ? "disclosure"
          : node.attr("role") === "tablist"
            ? "tabs"
            : node.attr("role") === "dialog"
              ? "dialog"
              : "toggle";
    feature(
      kind,
      clean(
        node.attr("aria-label") ||
          node.find("summary").first().text() ||
          node.text(),
      ).slice(0, 160) || kind,
      locator(el),
      {
        expanded: node.attr("aria-expanded") || "",
        controls: node.attr("aria-controls") || "",
      },
      "observed",
      "not_applicable",
    );
  }
  const structuredData: PageInventory["structuredData"] = [];
  for (const el of elements("script[type='application/ld+json']", 100)) {
    const text = $(el).text();
    if (text.length > 500000) {
      limits.push(
        "A JSON-LD block exceeds the 500 KB structured parsing limit; its captured HTML remains available.",
      );
      continue;
    }
    try {
      const value = JSON.parse(text),
        types: string[] = [];
      const walk = (v: unknown, depth = 0) => {
        if (depth > 30) return;
        if (Array.isArray(v)) {
          for (const item of v) walk(item, depth + 1);
        } else if (v && typeof v === "object") {
          for (const [key, item] of Object.entries(v)) {
            if (key === "@type")
              types.push(
                ...(Array.isArray(item) ? item.map(String) : [String(item)]),
              );
            if (item && typeof item === "object") walk(item, depth + 1);
          }
        }
      };
      walk(value);
      structuredData.push({
        value,
        types: [...new Set(types)],
        valid: true,
        locator: locator(el),
      });
    } catch {
      structuredData.push({
        value: null,
        types: [],
        valid: false,
        locator: locator(el),
      });
      issue(
        "json_ld_parse",
        "seo",
        "P2",
        "Structured data contains invalid JSON",
        "A captured JSON-LD block could not be parsed.",
        locator(el),
        "JSON.parse rejected the JSON-LD block",
        "Repair the JSON and verify its actual supported schema content.",
        ["JSON-LD parses and its facts match owner-approved content."],
      );
    }
  }
  const title = clean($("title").first().text()),
    description = $("meta[name=description]").attr("content") || "",
    language = $("html").attr("lang") || "",
    canonical =
      absolute($("link[rel~=canonical]").first().attr("href")) || null,
    robots = $("meta[name=robots]").attr("content") || "",
    viewport = $("meta[name=viewport]").attr("content") || "";
  if (!title)
    issue(
      "missing_title",
      "seo",
      "P1",
      "Page title is missing",
      "No nonempty document title was captured.",
      "head > title",
      "Empty or absent title",
      "Add a descriptive page-specific title.",
      ["The route has a meaningful title reflecting its content."],
    );
  if (!description.trim())
    issue(
      "missing_description",
      "seo",
      "P2",
      "Meta description is missing",
      "No explicit meta description was captured. Search engines may choose their own snippet.",
      "head",
      "Missing meta description",
      "Write an accurate page-specific description.",
      [
        "Description summarizes actual approved page content without unsupported claims.",
      ],
    );
  if (!language)
    issue(
      "missing_language",
      "accessibility",
      "P1",
      "Document language is missing",
      "The html element does not declare a language.",
      "html",
      "Missing lang attribute",
      "Declare the correct language and mark language changes where needed.",
      ["Document language matches its actual content."],
    );
  if (!viewport)
    issue(
      "missing_viewport",
      "ux",
      "P1",
      "Mobile viewport metadata is missing",
      "No viewport meta tag was captured.",
      "head",
      "Missing viewport metadata",
      "Use a suitable device-width viewport and verify the resulting layout.",
      ["Required pages fit and remain usable at 390, 768 and 1440 pixels."],
    );
  if (!headings.some((item) => item.level === 1))
    issue(
      "missing_primary_heading",
      "content",
      "P2",
      "Review the page's primary heading",
      "No h1 was found in captured markup; confirm the intended visual and semantic hierarchy.",
      "body",
      "No captured h1",
      "Give the page a clear primary topic and coherent heading structure.",
      ["Users can identify the page purpose and navigate its sections."],
      "design_judgment",
    );
  if (/noindex/i.test(robots))
    issue(
      "indexing_intent",
      "seo",
      "P2",
      "Confirm the intended indexing policy",
      "The page declares noindex. This may be intentional for private, duplicate or campaign pages.",
      "meta[name=robots]",
      robots,
      "Confirm owner indexing intent before changing the directive.",
      [
        "Each public route's indexing policy matches approved publication requirements.",
      ],
    );
  if (!canonical)
    issue(
      "canonical_review",
      "seo",
      "P3",
      "Review canonical URL policy",
      "No explicit canonical URL was captured. Canonical requirements depend on duplication and URL policy.",
      "head",
      "No explicit canonical link",
      "Decide a consistent canonical policy for public routes.",
      ["Canonical references, if required, resolve to approved public URLs."],
      "design_judgment",
    );
  let previousLevel = 0;
  for (const heading of headings) {
    if (previousLevel && heading.level > previousLevel + 1)
      issue(
        "heading_sequence",
        "accessibility",
        "P3",
        "Review skipped heading levels",
        "The captured hierarchy skips a level. Check whether its section structure remains understandable.",
        heading.locator,
        `${previousLevel} → ${heading.level}: ${heading.text}`,
        "Use a coherent semantic heading hierarchy.",
        ["Headings describe the page's actual nested sections."],
        "design_judgment",
      );
    previousLevel = heading.level;
  }
  let excerptBytes = 0;
  const sections = elements(
    "main,header,footer,section,article,aside,[role=main]",
    3000,
  ).map((el) => {
    const clone = $(el).clone();
    clone.find("script,style,noscript,template").remove();
    const text = clean(clone.text()),
      excerpt = text.slice(
        0,
        Math.min(12000, Math.max(0, 1_000_000 - excerptBytes)),
      );
    excerptBytes += excerpt.length;
    if (excerpt.length < text.length)
      limits.push(
        "Section text is an excerpt; complete normalized text and original HTML remain in the captured evidence.",
      );
    return {
      kind: el.tagName === "div" ? $(el).attr("role") || "region" : el.tagName,
      heading: clean($(el).find("h1,h2,h3,h4,h5,h6").first().text()).slice(
        0,
        1000,
      ),
      text: excerpt,
      locator: locator(el),
      wordCount: text ? text.split(/\s+/).length : 0,
    };
  });
  const textRoot = $("body").clone();
  textRoot.find("script,style,noscript,template,svg").remove();
  const text = clean(textRoot.text());
  const structuredFacts: { path: string; value: string }[] = [];
  const walkFacts = (value: unknown, path: string, depth = 0) => {
    if (depth > 30 || structuredFacts.length >= 3000) return;
    if (Array.isArray(value))
      value.forEach((item, index) =>
        walkFacts(item, `${path}[${index}]`, depth + 1),
      );
    else if (value && typeof value === "object")
      Object.entries(value).forEach(([key, item]) =>
        walkFacts(item, path + "." + key, depth + 1),
      );
    else if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    )
      structuredFacts.push({ path, value: String(value).slice(0, 4000) });
  };
  structuredData.forEach((item, index) =>
    walkFacts(item.value, `jsonld[${index}]`),
  );
  const businessData = {
    emails: [
      ...new Set([
        ...$("a[href^='mailto:']")
          .toArray()
          .map((el) => ($(el).attr("href") || "").slice(7).split("?")[0]),
        ...(text.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g) || []),
      ]),
    ].slice(0, 1000),
    phones: [
      ...new Set(
        $("a[href^='tel:']")
          .toArray()
          .map((el) => ($(el).attr("href") || "").slice(4)),
      ),
    ].slice(0, 1000),
    addresses: elements("address,[itemprop=address]", 1000).map((el) =>
      clean($(el).text()).slice(0, 4000),
    ),
    prices: [
      ...new Set(
        text.match(
          /(?:[$€£₹]\s?[\d,]+(?:\.\d{1,2})?|\b(?:USD|EUR|GBP|INR)\s+[\d,]+(?:\.\d{1,2})?)/g,
        ) || [],
      ),
    ].slice(0, 1000),
    structuredFacts,
  };
  const technology: PageInventory["technology"] = [];
  const markers = [
    [/_next\/|__next/i, "Next.js"],
    [/wp-content|wp-includes/i, "WordPress"],
    [/cdn\.shopify|Shopify\./i, "Shopify"],
    [/wixstatic|wix\.com/i, "Wix"],
    [/webflow|website-files\.com/i, "Webflow"],
    [/intercom|crisp\.chat|tawk\.to|tidio/i, "Chat widget"],
    [/recaptcha|hcaptcha/i, "Bot protection"],
    [/stripe|paypal/i, "Payment integration reference"],
    [
      /calendly|acuityscheduling|tidycal|cal\.com/i,
      "Scheduling integration reference",
    ],
  ] as const;
  for (const [pattern, name] of markers)
    if (pattern.test(html)) {
      const match = assets.find((asset) => pattern.test(asset.url));
      technology.push({
        name,
        evidence: match?.url || "Marker in captured HTML",
      });
      if (name === "Chat widget")
        feature(
          "chat",
          "Chat integration reference",
          "script",
          { provider: match?.url || "Inline source marker" },
          "inferred",
        );
    }
  const inlineCss = $("style")
      .toArray()
      .map((el) => $(el).text())
      .join("\n"),
    parsed = cssTokens(inlineCss, url + "#inline-styles");
  limits.push(...parsed.limits);
  for (const el of elements("[style]", 2000)) {
    const parsedInline = cssTokens(
      `x{${$(el).attr("style")}}`,
      url + " " + locator(el),
    );
    parsed.tokens.push(...parsedInline.tokens);
    limits.push(...parsedInline.limits);
  }
  const inventory: PageInventory = {
    url,
    title: title.slice(0, 4000),
    description: description.slice(0, 6000),
    language,
    canonical,
    robots,
    viewport,
    headings,
    links,
    anchors: elements("[id],[name]", 12000).map(
      (el) => $(el).attr("id") || $(el).attr("name") || "",
    ),
    sections,
    businessData,
    forms,
    features,
    assets,
    structuredData,
    technology,
    tokens: parsed.tokens,
    counts: {
      elements: $("*").length,
      links: $("a[href]").length,
      images: $("img").length,
      forms: $("form").length,
      headings: $("h1,h2,h3,h4,h5,h6").length,
      sections: $("main,header,footer,section,article,aside,[role=main]")
        .length,
      words: text ? text.split(/\s+/).length : 0,
    },
    limits: [...new Set(limits)],
  };
  return { inventory, references, findings };
}
export function pageFamily(inventory: PageInventory) {
  const path = new URL(inventory.url).pathname.toLowerCase(),
    text = (path + " " + inventory.title).toLowerCase();
  return path === "/"
    ? "home"
    : /privacy|terms|policy|legal|cookie/.test(text)
      ? "policy"
      : /contact/.test(text)
        ? "contact"
        : /about|team/.test(text)
          ? "about"
          : /service|product|solution/.test(text)
            ? "service"
            : /blog|article|news|guide/.test(text)
              ? "article"
              : "content";
}
