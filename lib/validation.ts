import { load } from "cheerio";
import * as csstree from "css-tree";
import { parsePublicUrl } from "./network";
import type { Discovery, Knowledge, PhotoAsset } from "./types";
import { HOME_PAGE } from "./site-pages";

export const PREVIEW_CSP =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src https: data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const normalized = (text: string) =>
  text.toLowerCase().replace(/\s+/g, " ").trim();
// Owners do not want captions/labels on photos (e.g. "Specimen No. 01", "Leaf -> water"):
// drop link-free <figcaption>s and short link-free text sitting alone beside an image.
// Photographer/Pexels credits always contain links and are kept. Mirrored for the
// studio preview by `hideImageCaptions` in site-pages.ts.
export function stripImageCaptions($: ReturnType<typeof load>) {
  $("figcaption")
    .filter((_, el) => !$(el).find("a[href]").length)
    .remove();
  $("figure, img").each((_, image) => {
    const siblings = $(image).parent().children();
    if (siblings.length !== 2) return;
    const other = siblings.not(image);
    const text = other.text().replace(/\s+/g, " ").trim();
    if (
      text &&
      text.length <= 90 &&
      !other.is("h1,h2,h3,h4,h5,h6,a,button,nav,header,footer,main,section") &&
      !other.find("a,img,figure,picture,h1,h2,h3,h4,h5,h6,button").length
    )
      other.remove();
  });
}
export function validateWebsite(
  raw: string,
  knowledge: Knowledge,
  previousHtml: string[] = [],
  discovery: Discovery | null = null,
  photos: PhotoAsset[] = [],
  options: {
    /** Other pages of this site that `page:<slug>` links may target. */
    pageSlugs?: string[];
    /** Inner page: contacts/services stay fact-checked but need not all appear. */
    subpage?: boolean;
  } = {},
) {
  const linkablePages = new Set([HOME_PAGE, ...(options.pageSlugs ?? [])]);
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
  stripImageCaptions($);
  $("meta[http-equiv]").each((_, element) => {
    if (
      ($(element).attr("http-equiv") ?? "").toLowerCase() === "x-ua-compatible"
    )
      $(element).remove();
  });
  if (
    !$("title").text().trim() ||
    !$("meta[name='viewport']").length ||
    !$("h1").length ||
    !$("main").length
  )
    throw new Error(
      `Add the missing document elements: ${[!$("title").text().trim() && "descriptive title", !$("meta[name='viewport']").length && "viewport meta", !$("h1").length && "primary h1 heading", !$("main").length && "main landmark (<main> around the page's main content)"].filter(Boolean).join(", ")}. Preserve the original design and return the complete document.`,
    );
  if (
    $("script,iframe,object,embed,form,base").length ||
    $("meta[http-equiv]").length
  )
    throw new Error(
      `Remove these unsupported elements: ${$(
        "script,iframe,object,embed,form,base,meta[http-equiv]",
      )
        .toArray()
        .map(
          (element) =>
            element.tagName +
            (element.tagName === "meta"
              ? ` (${$(element).attr("http-equiv")})`
              : ""),
        )
        .join(
          ", ",
        )}. Remove unsupported forms entirely and use native links/details for interactions. The application supplies CSP; omit http-equiv metadata. Return the full HTML document.`,
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
  // Legacy IE `behavior:` only; `scroll-behavior` and other prefixed properties are safe.
  if (/expression\s*\(|(?<![\w-])behavior\s*:|-moz-binding/i.test(allCss))
    throw new Error("Unsafe CSS is not allowed.");
  const approvedImages = new Set([
    ...(discovery?.pages.flatMap((p) =>
      p.images.slice(0, 12).map((i) => i.url),
    ) ?? []),
    ...photos.map((p) => p.url),
  ]);
  const usedImages = new Set<string>();
  function checkImage(url: string) {
    if (
      /^data:image\/(png|jpeg|webp|gif);base64,/.test(url) ||
      url.startsWith("#")
    )
      return;
    if (!approvedImages.has(url))
      throw new Error(
        "Use only the exact supplied source or approved Pexels image URLs.",
      );
    usedImages.add(url);
  }
  for (const match of allCss.matchAll(/url\(\s*["']?([^)'"\s]+)["']?\s*\)/gi)) {
    if (match[1].startsWith("data:image/") || match[1].startsWith("#"))
      continue;
    const url = parsePublicUrl(match[1]);
    if (url.protocol !== "https:") throw new Error("Use HTTPS asset URLs.");
    if (!["fonts.gstatic.com", "fonts.googleapis.com"].includes(url.hostname))
      checkImage(match[1]);
  }
  $("img[src],image[href],image[xlink\\:href],[poster]").each((_, el) => {
    checkImage(
      $(el).attr("src") ??
        $(el).attr("href") ??
        $(el).attr("xlink:href") ??
        $(el).attr("poster") ??
        "",
    );
  });
  const usedPhotos = photos.filter((p) => usedImages.has(p.url));
  function creditExists(urls: string[], label: string) {
    return $("body a[href]")
      .toArray()
      .some(
        (el) =>
          urls.includes($(el).attr("href") ?? "") &&
          normalized($(el).text()).includes(normalized(label)) &&
          !$(el).is("[hidden],[aria-hidden='true']") &&
          !$(el).parents("[hidden],[aria-hidden='true']").length,
      );
  }
  if (
    usedPhotos.length &&
    !creditExists(
      ["https://www.pexels.com", "https://www.pexels.com/"],
      "Pexels",
    )
  )
    throw new Error(
      "Add a visible Pexels credit linked to https://www.pexels.com/.",
    );
  for (const photo of usedPhotos)
    if (
      !creditExists(
        [photo.sourceUrl, photo.photographerUrl],
        photo.photographer,
      )
    )
      throw new Error(
        `Credit photographer ${photo.photographer} with the supplied Pexels photo or photographer link.`,
      );
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
      if (name === "href" && /^page:/i.test(value)) {
        const target = /^page:([a-z0-9-]+)(?:#[\w-]*)?$/i.exec(value);
        if (!target || !linkablePages.has(target[1].toLowerCase()))
          invalid = `Link only to this site's pages: ${[...linkablePages].map((slug) => `page:${slug}`).join(", ")}.`;
        continue;
      }
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
  // Models routinely add Google Fonts preconnect hints; they are optional, so drop them
  // rather than spending a full repair round trip on them.
  $("link[rel~='preconnect'],link[rel~='dns-prefetch']")
    .filter((_, el) =>
      /^https:\/\/fonts\.(googleapis|gstatic)\.com\/?$/.test(
        $(el).attr("href") ?? "",
      ),
    )
    .remove();
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
    text.length < (options.subpage ? 200 : 400) ||
    /lorem ipsum|\bTODO\b|your (business|company) name/i.test(text)
  )
    throw new Error(
      "Provide complete business-specific copy without placeholders.",
    );
  if (!options.subpage)
    for (const service of knowledge.services.filter((s) => s.name))
      if (!text.includes(normalized(service.name)))
        throw new Error(`Include the supplied service: ${service.name}`);
  if (
    knowledge.businessName &&
    !text.includes(normalized(knowledge.businessName))
  )
    throw new Error("Include the exact supplied business name.");
  if (
    !options.subpage &&
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
    !options.subpage &&
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
    photoCredits: usedPhotos.length
      ? [
          {
            label: "Pexels",
            urls: ["https://www.pexels.com", "https://www.pexels.com/"],
          },
          ...usedPhotos.map((photo) => ({
            label: photo.photographer,
            urls: [photo.sourceUrl, photo.photographerUrl],
          })),
        ]
      : [],
    warnings: $("img:not([alt])").length
      ? ["Some images are missing alternative text."]
      : [],
  };
}
