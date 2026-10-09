import { load } from "cheerio";
import * as csstree from "css-tree";
import { parsePublicUrl } from "./network";
import type { Discovery, Knowledge } from "./types";

export const PREVIEW_CSP =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src https: data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const normalized = (text: string) =>
  text.toLowerCase().replace(/\s+/g, " ").trim();
export function validateWebsite(
  raw: string,
  knowledge: Knowledge,
  previousHtml: string[] = [],
  discovery: Discovery | null = null,
) {
  const html = raw
    .trim()
    .replace(/^```(?:html)?\s*/i, "")
    .replace(/\s*```$/, "");
  if (
    html.length > 350000 ||
    !/^<!doctype html>/i.test(html) ||
    !/<\/html>\s*$/i.test(html)
  )
    throw new Error(
      "Return a complete, bounded HTML document with a doctype and closing html tag.",
    );
  const $ = load(html);
  if (
    !$("title").text().trim() ||
    !$("meta[name='viewport']").length ||
    !$("h1").length ||
    !$("main").length
  )
    throw new Error(
      "Add a title, viewport meta, primary heading and main landmark.",
    );
  if (
    $("script,iframe,object,embed,form,base").length ||
    $("meta[http-equiv]").length
  )
    throw new Error(
      "Remove scripts, embedded content, forms, base tags and http-equiv metadata. Use native HTML/CSS interactions.",
    );
  const css = $("style")
    .map((_, el) => $(el).text())
    .get()
    .join("\n");
  const allCss =
    css +
    "\n" +
    $("[style]")
      .map((_, el) => $(el).attr("style") ?? "")
      .get()
      .join("\n");
  if (css.length < 800 || !/@media\b/.test(css))
    throw new Error("Provide bespoke CSS and mobile media queries.");
  try {
    csstree.parse(css, { parseCustomProperty: true });
  } catch {
    throw new Error("Fix invalid CSS syntax.");
  }
  if (/expression\s*\(|behavior\s*:|-moz-binding/i.test(allCss))
    throw new Error("Unsafe CSS is not allowed.");
  for (const match of allCss.matchAll(/url\(\s*["']?([^)'"\s]+)["']?\s*\)/gi)) {
    if (match[1].startsWith("data:image/") || match[1].startsWith("#"))
      continue;
    const url = parsePublicUrl(match[1]);
    if (url.protocol !== "https:") throw new Error("Use HTTPS asset URLs.");
  }
  const ids = new Set(
    $("[id]")
      .map((_, el) => $(el).attr("id")!)
      .get(),
  );
  let invalid: string | undefined;
  $("*").each((_, el) => {
    for (const [name, value] of Object.entries(
      el.type === "tag" ? el.attribs : {},
    )) {
      if (
        /^on/i.test(name) ||
        ["srcdoc", "action", "formaction", "ping", "srcset"].includes(name)
      )
        invalid = "Remove executable attributes.";
      if (!["href", "src", "xlink:href", "poster"].includes(name)) continue;
      if (value.startsWith("#")) {
        if (name === "href" && (!value.slice(1) || !ids.has(value.slice(1))))
          invalid =
            "Fix navigation anchors so they point to existing section IDs.";
        continue;
      }
      if (name === "href" && /^(tel:|mailto:)/.test(value)) continue;
      if (
        name === "src" &&
        /^data:image\/(png|jpeg|webp|gif);base64,/.test(value)
      )
        continue;
      try {
        if (parsePublicUrl(value).protocol !== "https:")
          invalid = "Use public HTTPS links and assets.";
      } catch {
        invalid = "Remove invalid, relative or unsafe resource URLs.";
      }
    }
  });
  if (invalid) throw new Error(invalid);
  const evidence = [
    knowledge.description,
    knowledge.additionalDetails,
    knowledge.phone,
    knowledge.email,
    ...knowledge.services.map((s) => s.description),
    ...(discovery?.pages.map((p) => p.text) ?? []),
  ].join(" ");
  const allowedEmails = new Set(
    [
      knowledge.email,
      ...(evidence.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g) ?? []),
      ...(discovery?.pages.flatMap((p) => p.emails) ?? []),
    ]
      .map((s) => s.toLowerCase())
      .filter(Boolean),
  );
  const allowedPhones = new Set(
    [
      knowledge.phone,
      ...(evidence.match(/\+?\d[\d ().-]{6,25}\d/g) ?? []),
      ...(discovery?.pages.flatMap((p) => p.phones) ?? []),
    ]
      .map((s) => s.replace(/\D/g, ""))
      .filter(Boolean),
  );
  for (const element of $("a[href^='mailto:']").toArray())
    if (
      !allowedEmails.has(
        ($(element).attr("href") ?? "").slice(7).split("?")[0].toLowerCase(),
      )
    )
      throw new Error(
        "Remove invented email addresses. Use only an owner-provided or source-supported email.",
      );
  for (const element of $("a[href^='tel:']").toArray())
    if (
      !allowedPhones.has(
        ($(element).attr("href") ?? "").slice(4).replace(/\D/g, ""),
      )
    )
      throw new Error(
        "Remove invented phone numbers. Use only an owner-provided or source-supported phone.",
      );
  if (
    $("link")
      .toArray()
      .some(
        (el) =>
          $(el).attr("rel") !== "stylesheet" ||
          !($(el).attr("href") ?? "").startsWith(
            "https://fonts.googleapis.com/",
          ),
      )
  )
    throw new Error(
      "Only optional Google Fonts stylesheet links may be external.",
    );
  const text = normalized($("body").text());
  if (
    text.length < 400 ||
    /lorem ipsum|\bTODO\b|your (business|company) name/i.test(text)
  )
    throw new Error(
      "Provide complete business-specific copy without placeholders.",
    );
  for (const service of knowledge.services.filter((s) => s.name))
    if (!text.includes(normalized(service.name)))
      throw new Error(`Include the supplied service: ${service.name}`);
  if (
    knowledge.businessName &&
    !text.includes(normalized(knowledge.businessName))
  )
    throw new Error("Include the exact supplied business name.");
  if (
    knowledge.email &&
    !$("a[href^='mailto:']")
      .toArray()
      .some(
        (el) =>
          $(el).attr("href")?.slice(7).split("?")[0].toLowerCase() ===
          knowledge.email.toLowerCase(),
      )
  )
    throw new Error("Include the owner's exact email as a mailto link.");
  if (
    knowledge.phone &&
    !$("a[href^='tel:']")
      .toArray()
      .some(
        (el) =>
          $(el).attr("href")?.replace(/\D/g, "") ===
          knowledge.phone.replace(/\D/g, ""),
      )
  )
    throw new Error("Include the owner's exact phone number as a tel link.");
  const canonical = (document: string) => {
    const parsed = load(document);
    parsed("meta[http-equiv='Content-Security-Policy']").remove();
    return normalized(parsed.html());
  };
  if (previousHtml.some((p) => canonical(p) === canonical(html)))
    throw new Error(
      "This duplicates another version. Create an original composition and design.",
    );
  $("head").prepend(
    `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`,
  );
  return {
    html: $.html(),
    warnings: $("img:not([alt])").length
      ? ["Some images are missing alternative text."]
      : [],
  };
}
