import type { Discovery } from "./types";

// Preserve the raw crawl separately. A bounded evidence packet prioritizes business pages,
// deduplicates site-wide contacts and avoids overflowing provider contexts on large sites.
export function compactDiscovery(discovery: Discovery) {
  const rank = (url: string, title: string) =>
    /contact|about|service|pricing|team|location|faq|hours/i.test(
      `${url} ${title}`,
    )
      ? 0
      : /blog|news|archive/i.test(url)
        ? 2
        : 1;
  const ranked = [...discovery.pages].sort(
    (a, b) =>
      (a.url === discovery.pages[0]?.url ? -1 : rank(a.url, a.title)) -
      (b.url === discovery.pages[0]?.url ? -1 : rank(b.url, b.title)),
  );
  const selected = ranked.slice(0, 80);
  const contacts = (key: "phones" | "emails") => [
    ...new Set(discovery.pages.flatMap((p) => p[key])),
  ];
  const allPhones = contacts("phones"),
    allEmails = contacts("emails");
  const boundedContacts = (values: string[]) => {
    let budget = 15000;
    return values.slice(0, 1000).filter((value) => {
      const size = JSON.stringify(value).length;
      if (size > budget) return false;
      budget -= size;
      return true;
    });
  };
  const phones = boundedContacts(allPhones),
    emails = boundedContacts(allEmails);
  let indexBudget = 60000;
  const pageIndex: { url: string; title: string }[] = [];
  for (const page of ranked) {
    const entry = { url: page.url, title: page.title.slice(0, 100) };
    const size = JSON.stringify(entry).length;
    if (size > indexBudget) continue;
    indexBudget -= size;
    pageIndex.push(entry);
  }
  const notes = [
    "Raw captured pages are retained in the studio. This AI packet prioritizes business evidence within context limits.",
  ];
  if (pageIndex.length < discovery.pages.length)
    notes.push("The source index was shortened to fit the context budget.");
  let detailBudget = 100000;
  const details = selected.flatMap((p) => {
    const entry = {
      url: p.url,
      title: p.title.slice(0, 200),
      description: p.description.slice(0, 400),
      headings: p.headings.slice(0, 6).map((h) => h.slice(0, 150)),
      text: p.text.slice(0, 1200),
      textShortened: p.truncated || p.text.length > 1200,
      phones: p.phones.slice(0, 5),
      emails: p.emails.slice(0, 5),
      images: p.images
        .slice(0, 2)
        .map((image) => ({ url: image.url, alt: image.alt.slice(0, 200) })),
      structuredData: p.structuredData
        .filter((data) => JSON.stringify(data).length < 1000)
        .slice(0, 1),
      design: {
        colors: p.design.colors.slice(0, 8),
        fonts: p.design.fonts.slice(0, 4).map((font) => font.slice(0, 100)),
      },
    };
    const size = JSON.stringify(entry).length;
    if (size > detailBudget) return [];
    detailBudget -= size;
    return [entry];
  });
  return {
    origin: discovery.origin,
    coverage: {
      read: discovery.pages.length,
      discovered: discovery.discovered,
      complete: discovery.complete,
      warnings: discovery.warnings
        .slice(0, 20)
        .map((warning) => warning.slice(0, 300)),
    },
    contextCoverage: {
      detailedPages: details.length,
      indexedPages: pageIndex.length,
      contactsShortened:
        allPhones.length > phones.length || allEmails.length > emails.length,
      notes,
    },
    contacts: {
      phones,
      emails,
    },
    pageIndex,
    pages: details,
  };
}
