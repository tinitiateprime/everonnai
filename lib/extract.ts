import { load } from "cheerio";
import { parsePublicUrl } from "./network";
import type { SourcePage } from "./types";

export const unique = <T>(items: T[]) => [...new Set(items)];
const clean = (value: string) => value.replace(/\s+/g, " ").trim();
export function designCues(css: string) {
  return {
    colors: unique(
      css.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]{1,80}\)|hsla?\([^)]{1,80}\)/gi) ??
        [],
    ).slice(0, 35),
    fonts: unique(
      [...css.matchAll(/font-family\s*:\s*([^;}]{1,180})/gi)].map((m) =>
        clean(m[1]),
      ),
    ).slice(0, 15),
  };
}
export function extractPage(
  html: string,
  url: string,
  options: { fullText?: boolean } = {},
): SourcePage {
  const $ = load(html);
  const absolute = (value?: string) => {
    try {
      return value ? parsePublicUrl(value, url).href : "";
    } catch {
      return "";
    }
  };
  const links = unique(
    $("a[href]")
      .map((_, el) => absolute($(el).attr("href")))
      .get()
      .filter((url) => url && url.length <= 2048)
      .slice(0, 2000),
  );
  const emails = unique(
    $("a[href^='mailto:']")
      .map((_, el) => ($(el).attr("href") ?? "").slice(7).split("?")[0])
      .get(),
  );
  const phones = unique(
    $("a[href^='tel:']")
      .map((_, el) => ($(el).attr("href") ?? "").slice(4))
      .get(),
  );
  const images = $("img")
    .map((_, el) => ({
      url: absolute($(el).attr("src") ?? $(el).attr("data-src")),
      alt: ($(el).attr("alt") ?? "").slice(0, 2000),
    }))
    .get()
    .filter((i) => i.url && i.url.length <= 2048)
    .slice(0, 30);
  const socialImage = absolute($("meta[property='og:image']").attr("content"));
  if (socialImage)
    images.unshift({ url: socialImage, alt: "Website preview image" });
  const structuredData: unknown[] = [];
  $("script[type='application/ld+json']").each((_, el) => {
    try {
      structuredData.push(JSON.parse($(el).text().slice(0, 30000)));
    } catch {
      /* Broken source metadata is not a crawl failure. */
    }
  });
  const css = $("style")
    .map((_, el) => $(el).text())
    .get()
    .join("\n")
    .slice(0, 20000);
  const stylesheets = $("link[rel='stylesheet']")
    .map((_, el) => absolute($(el).attr("href")))
    .get()
    .filter(Boolean)
    .slice(0, 8);
  const title = clean($("title").first().text()).slice(0, 2000);
  const description = (
    $("meta[name='description']").attr("content") ?? ""
  ).slice(0, 6000);
  const headings = $("h1,h2,h3")
    .map((_, el) => clean($(el).text()).slice(0, 4000))
    .get()
    .filter(Boolean)
    .slice(0, 60);
  $("script,style,noscript,svg,template").remove();
  $("a").append(" ");
  $("br").replaceWith(" ");
  $("p,div,section,li,h1,h2,h3,address").append(" ");
  const fullText = clean($("body").text());
  emails.push(...(fullText.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g) ?? []));
  phones.push(
    ...(fullText.match(
      /(?:\+\d{1,3}[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/g,
    ) ?? []),
  );
  const collectContacts = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) collectContacts(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (["telephone", "phone"].includes(key) && typeof item === "string")
        phones.push(item.replace(/^tel:/, ""));
      if (key === "email" && typeof item === "string")
        emails.push(item.replace(/^mailto:/, ""));
      if (item && typeof item === "object") collectContacts(item);
    }
  };
  for (const item of structuredData) collectContacts(item);
  return {
    url,
    title,
    description,
    text: options.fullText ? fullText : fullText.slice(0, 12000),
    truncated: !options.fullText && fullText.length > 12000,
    headings,
    links,
    phones: unique(phones)
      .filter((value) => value.length <= 200)
      .slice(0, 25),
    emails: unique(emails)
      .filter((value) => value.length <= 320)
      .slice(0, 25),
    images,
    structuredData: structuredData.slice(0, 10),
    design: { ...designCues(css), css: css.slice(0, 8000), stylesheets },
  };
}
