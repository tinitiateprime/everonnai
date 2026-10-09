// Shared (server + browser) helpers for multi-page generated websites.
// AI documents link between pages with `page:<slug>` hrefs (optionally `#section`);
// each surface rewrites them: served URLs, studio preview, or downloaded files.

export const HOME_PAGE = "home";
export const PAGE_SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const MAX_EXTRA_PAGES = 4;
const PAGE_LINK = /\bhref\s*=\s*(["'])page:([a-z0-9-]+)(#[^"']*)?\1/gi;

export function pageLinks(html: string) {
  return [...html.matchAll(PAGE_LINK)].map((m) => ({
    slug: m[2].toLowerCase(),
    fragment: m[3] ?? "",
  }));
}
export function rewritePageLinks(
  html: string,
  resolve: (slug: string, fragment: string) => string,
) {
  return html.replace(
    PAGE_LINK,
    (_, quote: string, slug: string, fragment = "") =>
      `href=${quote}${resolve(slug.toLowerCase(), fragment)}${quote}`,
  );
}
/**
 * Links for a page served at `/service/{business}/{version}[/{slug}]`. Pages that
 * were never built (or failed) fall back to the home page.
 */
export function servedPageLinks(
  html: string,
  sitePath: string,
  builtSlugs: Iterable<string>,
) {
  const built = new Set(builtSlugs);
  return rewritePageLinks(
    html,
    (slug, fragment) =>
      `${built.has(slug) ? `${sitePath}/${slug}` : sitePath}${fragment}`,
  );
}
/** Links between downloaded files: `index.html` plus `<slug>.html` per built page. */
export function downloadedPageLinks(
  html: string,
  builtSlugs: Iterable<string>,
) {
  const built = new Set(builtSlugs);
  return rewritePageLinks(
    html,
    (slug, fragment) => `${built.has(slug) ? slug : "index"}.html${fragment}`,
  );
}

/** Browser mirror of `stripImageCaptions` (validation.ts) for the studio preview. */
export function hideImageCaptions(html: string) {
  if (typeof DOMParser === "undefined") return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc
    .querySelectorAll("figcaption")
    .forEach((el) => !el.querySelector("a[href]") && el.remove());
  doc.querySelectorAll("figure, img").forEach((image) => {
    const siblings = [...(image.parentElement?.children ?? [])];
    if (siblings.length !== 2) return;
    const other = siblings.find((el) => el !== image)!;
    const text = (other.textContent ?? "").replace(/\s+/g, " ").trim();
    if (
      text &&
      text.length <= 90 &&
      !other.matches(
        "h1,h2,h3,h4,h5,h6,a,button,nav,header,footer,main,section",
      ) &&
      !other.querySelector("a,img,figure,picture,h1,h2,h3,h4,h5,h6,button")
    )
      other.remove();
  });
  return `<!DOCTYPE html>${doc.documentElement.outerHTML}`;
}
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
/** Minimal uncompressed (stored) ZIP archive, enough for a handful of HTML files. */
export function zipFiles(files: { name: string; content: string }[]) {
  const encoder = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, 0x0800, true); // UTF-8 names
    header.setUint32(14, crc, true);
    header.setUint32(18, data.length, true);
    header.setUint32(22, data.length, true);
    header.setUint16(26, name.length, true);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    local.push(new Uint8Array(header.buffer), name, data);
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const parts = [...local, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let position = 0;
  for (const part of parts) {
    out.set(part, position);
    position += part.length;
  }
  return out;
}
