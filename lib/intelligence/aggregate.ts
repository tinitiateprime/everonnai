import { crawlable } from "../crawler";
import type { InventoryPage, Snapshot } from "../discovery/contracts";
import { referenceId, pageFamily } from "./extract";
import type {
  Advice,
  Finding,
  IntelligenceReport,
  IntelligenceRun,
  PageAssessment,
  Reference,
  SourceAsset,
  Token,
} from "./contracts";
export function browserFindings(page: PageAssessment) {
  const findings: Finding[] = [],
    references: Reference[] = [];
  const add = (
    rule: string,
    area: Finding["area"],
    priority: Finding["priority"],
    title: string,
    detail: string,
    locator: string,
    observation: string,
    action: string,
    acceptance: string[],
    kind: Finding["kind"] = "observed",
  ) => {
    const id = referenceId(page.captureId, "browser-finding:" + rule + locator),
      evidence = referenceId(
        page.captureId,
        "browser-evidence:" + rule + locator,
      );
    references.push({
      id: evidence,
      captureId: page.captureId,
      url: page.inventory.url,
      locator,
      observation,
      kind: "browser",
    });
    findings.push({
      id,
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
  for (const view of page.browser.viewports) {
    if (view.overflowPixels > 1)
      add(
        "viewport_overflow",
        "ux",
        "P1",
        `Horizontal overflow at ${view.width}px`,
        "The observed document extends beyond its viewport.",
        `viewport:${view.width}`,
        `${view.overflowPixels}px overflow`,
        "Correct wide containers, images and navigation without hiding required content.",
        [
          "The required route fits 390, 768 and 1440 pixel viewports within 1px overflow.",
        ],
      );
    if (view.hiddenContent)
      add(
        "clipped_content",
        "ux",
        "P1",
        "Content region is clipped",
        "An observed main/article region hides vertical overflow.",
        `viewport:${view.width}`,
        "Scroll height exceeds a clipped content region",
        "Preserve readable content and provide intentional accessible scrolling when needed.",
        [
          "Required content remains visible or accessible through an explicit usable scroll region.",
        ],
      );
    if (view.smallControls)
      add(
        "small_controls",
        "ux",
        "P2",
        `Review small controls at ${view.width}px`,
        "Some visible form/button controls are smaller than 24px in a dimension. Target-spacing exceptions and actual usability require review.",
        `viewport:${view.width}`,
        `${view.smallControls} small controls`,
        "Review pointer targets and spacing in their actual context.",
        [
          "Required controls can be reliably operated with pointer and keyboard.",
        ],
        "design_judgment",
      );
  }
  const axe = new Map<
    string,
    PageAssessment["browser"]["accessibility"][number]
  >();
  for (const finding of page.browser.accessibility)
    axe.set(
      finding.rule + finding.inconclusive + finding.targets.join("|"),
      finding,
    );
  for (const item of axe.values())
    add(
      `axe:${item.rule}`,
      "accessibility",
      item.inconclusive
        ? "P2"
        : ["critical", "serious"].includes(item.impact)
          ? "P1"
          : "P2",
      item.inconclusive
        ? `Manual accessibility review: ${item.description}`
        : item.description,
      item.inconclusive
        ? "The accessibility engine could not determine this check automatically."
        : `Automated accessibility finding (${item.impact}).`,
      item.targets.join("; ").slice(0, 1500),
      `Rule ${item.rule}; ${item.targets.length} affected sampled elements; ${item.helpUrl}`,
      "Apply the rule's context-appropriate remediation and verify the affected interaction.",
      [
        "The reported automated rule passes on the upgraded route.",
        "Manual accessibility review covers cases the engine cannot establish.",
      ],
      item.inconclusive ? "inferred" : "observed",
    );
  for (const resource of page.browser.resources) {
    if (resource.outcome === "http_error")
      add(
        "failed_resource",
        "ux",
        "P1",
        "A required resource returns an HTTP error",
        `The observed ${resource.type} request returned HTTP ${resource.status}.`,
        resource.url,
        `HTTP ${resource.status}`,
        "Fix or replace the referenced resource and confirm its correct content.",
        ["Required assets and scripts load successfully on the upgraded page."],
      );
    if (
      resource.outcome === "loaded" &&
      resource.byteSize > 500000 &&
      ["image", "script", "stylesheet"].includes(resource.type)
    )
      add(
        "asset_weight",
        "performance",
        "P2",
        "Review a large downloaded resource",
        `A single ${resource.type} response contains ${resource.byteSize} bytes under this inspection profile.`,
        resource.url,
        `${resource.byteSize} downloaded response bytes`,
        "Review responsive media, compression and dependency delivery; measure the result under a comparable profile.",
        [
          "Declared asset/performance budgets pass under a repeatable measurement profile.",
        ],
        "measured",
      );
  }
  if (page.browser.runtimeErrors)
    add(
      "runtime_errors",
      "features",
      "P2",
      "Browser runtime errors were observed",
      "Source scripts raised errors during the guarded replay. Blocked resources or replay conditions may contribute.",
      "browser runtime",
      `${page.browser.runtimeErrors} page errors`,
      "Reproduce the affected workflow on the live source and remove actual runtime failures in the upgrade.",
      ["Required upgraded workflows run without browser runtime errors."],
      "inferred",
    );
  for (const item of page.browser.interactions.filter(
    (item) => item.outcome === "unchanged",
  ))
    add(
      "disclosure_interaction",
      "features",
      "P2",
      "Review an unresponsive disclosure",
      "A sampled native disclosure did not change its open state.",
      item.locator,
      item.detail,
      "Confirm intended disclosure behavior and keyboard activation.",
      [
        "The disclosure reveals and hides its content with pointer and keyboard.",
      ],
    );
  return { findings, references };
}
export function aggregateReport(
  run: IntelligenceRun,
  snapshot: Snapshot,
  inventory: InventoryPage[],
  assessments: PageAssessment[],
  advice: Advice,
): IntelligenceReport {
  const origin = new URL(snapshot.scope.inputUrl).origin,
    normal = (url: string) => {
      try {
        const value = new URL(url);
        value.hash = "";
        value.pathname = value.pathname.replace(/\/$/, "") || "/";
        return value.href;
      } catch {
        return url;
      }
    };
  const references = assessments.flatMap((page) => page.references),
    findings = assessments.flatMap((page) => page.findings),
    features: IntelligenceReport["features"] = [];
  const priorities: Record<string, number> = { P0: 0, P1: 0, P2: 0, P3: 0 },
    families: Record<string, number> = {},
    assessmentGaps: string[] = [];
  const targets = new Map<string, PageAssessment>();
  const membersByCapture = new Map(
    inventory.map((item) => [item.captureId, item]),
  );
  for (const page of assessments) {
    targets.set(normal(page.inventory.url), page);
    const member = membersByCapture.get(page.captureId);
    if (member) targets.set(normal(member.url), page);
  }
  const declared = new Map(inventory.map((item) => [normal(item.url), item]));
  const edges: IntelligenceReport["navigation"]["edges"] = [],
    unassessed = new Set<string>(),
    excluded = new Set<string>();
  const tokens = new Map<string, Token & { pageUrls: string[] }>(),
    assets = new Map<string, SourceAsset & { pages: string[] }>(),
    components = new Map<
      string,
      { kind: string; pages: string[]; count: number }
    >();
  const addFinding = (
    page: PageAssessment,
    rule: string,
    area: Finding["area"],
    priority: Finding["priority"],
    title: string,
    detail: string,
    locator: string,
    observation: string,
    action: string,
    acceptance: string[],
    kind: Finding["kind"] = "observed",
  ) => {
    const evidence = referenceId(page.captureId, "graph:" + rule + locator);
    references.push({
      id: evidence,
      captureId: page.captureId,
      url: page.inventory.url,
      locator,
      observation,
      kind: "inventory",
    });
    findings.push({
      id: referenceId(page.captureId, "graph-finding:" + rule + locator),
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
  for (const page of assessments) {
    const effective = page.renderedInventory ?? page.inventory,
      family = pageFamily(effective);
    families[family] = (families[family] || 0) + 1;
    if (page.browser.status !== "observed")
      assessmentGaps.push(
        `Browser assessment incomplete: ${page.inventory.url}`,
      );
    for (const limit of [
      ...page.inventory.limits,
      ...(page.renderedInventory?.limits ?? []),
    ].filter((item) => !/Section text is an excerpt/.test(item)))
      assessmentGaps.push(`${page.inventory.url}: ${limit}`);
    for (const limit of page.browser.limitations.filter((item) =>
      /budget was reached|exceeds the|could not complete|could not be fully parsed|could not be parsed|did not finish/.test(
        item,
      ),
    ))
      assessmentGaps.push(`${page.inventory.url}: ${limit}`);
    const combined = new Map<
      string,
      (typeof page.inventory.features)[number]
    >();
    for (const feature of [
      ...page.inventory.features,
      ...(page.renderedInventory?.features ?? []),
    ])
      combined.set(feature.kind + feature.locator, feature);
    for (const feature of combined.values()) {
      features.push({
        ...feature,
        captureId: page.captureId,
        url: page.inventory.url,
      });
      const component = components.get(feature.kind) ?? {
        kind: feature.kind,
        pages: [],
        count: 0,
      };
      component.count++;
      if (!component.pages.includes(page.inventory.url))
        component.pages.push(page.inventory.url);
      components.set(feature.kind, component);
    }
    for (const asset of [
      ...page.inventory.assets,
      ...(page.renderedInventory?.assets ?? []),
    ]) {
      const key = asset.kind + ":" + asset.url,
        value = assets.get(key) ?? { ...asset, pages: [] };
      if (!value.pages.includes(page.inventory.url))
        value.pages.push(page.inventory.url);
      assets.set(key, value);
    }
    for (const resource of page.browser.resources.filter(
      (item) =>
        ["font", "stylesheet", "script", "image"].includes(item.type) &&
        item.outcome === "loaded",
    )) {
      const kind = resource.type as SourceAsset["kind"],
        key = kind + ":" + resource.url,
        value = assets.get(key) ?? {
          kind,
          url: resource.url,
          locator: "browser network",
          alt: null,
          details: {
            byteSize: resource.byteSize,
            sha256: resource.sha256 || "",
            status: resource.status || 0,
          },
          pages: [],
        };
      if (!value.pages.includes(page.inventory.url))
        value.pages.push(page.inventory.url);
      assets.set(key, value);
    }
    for (const token of [
      ...page.inventory.tokens,
      ...page.browser.viewports.flatMap((view) => view.tokens),
    ]) {
      const key = token.kind + ":" + token.name + ":" + token.value,
        value = tokens.get(key) ?? { ...token, count: 0, pageUrls: [] };
      value.count += token.count;
      if (!value.pageUrls.includes(page.inventory.url))
        value.pageUrls.push(page.inventory.url);
      tokens.set(key, value);
    }
    for (const link of effective.links.filter((link) => link.internal)) {
      const target = normal(link.url),
        allowed = crawlable(target, origin);
      if (!allowed) {
        excluded.add(target);
        continue;
      }
      edges.push({
        from: normal(page.inventory.url),
        to: target,
        text: link.text,
      });
      const destination = targets.get(target),
        member = declared.get(target);
      if (!destination) {
        if (
          member?.outcome === "skipped" &&
          /HTTP (404|410)\b/.test(member.reason || "")
        )
          addFinding(
            page,
            "broken_internal_link",
            "ux",
            "P1",
            "An internal link targets a missing page",
            `The frozen inventory recorded ${member.reason}.`,
            link.locator,
            `${link.text}: ${target}`,
            "Repair the link or implement its approved destination.",
            [
              "The linked destination returns its intended content without a missing-page fallback.",
            ],
          );
        else unassessed.add(target);
      } else if (link.fragment) {
        let fragment = link.fragment.slice(1);
        try {
          fragment = decodeURIComponent(fragment);
        } catch {
          /* Keep the literal fragment if source URI decoding fails. */
        }
        if (
          fragment &&
          !destination.inventory.anchors.includes(fragment) &&
          !destination.renderedInventory?.anchors.includes(fragment)
        )
          addFinding(
            page,
            "missing_anchor",
            "ux",
            "P2",
            "An internal fragment has no observed target",
            `The linked fragment ${link.fragment} was not found in captured/rendered target markup.`,
            link.locator,
            link.url,
            "Repair the fragment target or confirm dynamic anchor creation.",
            ["The link reaches the intended visible section."],
            "inferred",
          );
      }
      if (!link.text)
        addFinding(
          page,
          "empty_link_label",
          "accessibility",
          "P2",
          "Review an unnamed link",
          "No text or aria-label was extracted; image alternate text or aria-labelledby may supply its accessible name.",
          link.locator,
          link.url,
          "Confirm an informative accessible name in the browser accessibility tree.",
          ["The link's purpose can be identified without visual context."],
          "inferred",
        );
    }
    const backend = combined.values();
    for (const feature of backend)
      if (feature.backend === "not_tested")
        addFinding(
          page,
          "feature_contract",
          "features",
          "P2",
          `Confirm the ${feature.kind} integration`,
          "The feature's public UI or entry point was detected. Backend persistence, provider configuration and side effects have not been verified.",
          feature.locator,
          feature.label,
          "Confirm its owner-approved workflow, provider/configuration and acceptance tests before rebuilding its UI.",
          [
            "The upgraded feature uses a supported backend.",
            "Valid, invalid, duplicate and failure journeys have been verified against the exact build.",
          ],
          "inferred",
        );
  }
  const duplicate = (key: "title" | "description", rule: string) => {
    const groups = new Map<string, PageAssessment[]>();
    for (const page of assessments) {
      const value = (page.renderedInventory ?? page.inventory)[key]
        .trim()
        .toLowerCase();
      if (value) {
        const items = groups.get(value) ?? [];
        items.push(page);
        groups.set(value, items);
      }
    }
    for (const items of groups.values())
      if (
        items.length > 1 &&
        new Set(items.map((page) => page.textSha256)).size > 1
      )
        addFinding(
          items[0],
          rule,
          "seo",
          "P2",
          `Review repeated page ${key}`,
          `${items.length} pages with different captured text share this ${key}.`,
          `head:${key}`,
          items
            .map((page) => page.inventory.url)
            .join("; ")
            .slice(0, 1000),
          "Use content-specific metadata where these routes have distinct purposes; review intentional canonical aliases.",
          [
            "Distinct public page purposes have appropriate titles and descriptions.",
          ],
          "design_judgment",
        );
  };
  duplicate("title", "duplicate_titles");
  duplicate("description", "duplicate_descriptions");
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const values = outgoing.get(edge.from) ?? [];
    values.push(edge.to);
    outgoing.set(edge.from, values);
  }
  const entry = targets.has(normal(snapshot.scope.inputUrl))
      ? normal(snapshot.scope.inputUrl)
      : normal(assessments[0]?.inventory.url || snapshot.scope.inputUrl),
    reachable = new Set<string>(),
    queue = [entry];
  while (queue.length) {
    const from = queue.pop()!;
    if (reachable.has(from)) continue;
    reachable.add(from);
    for (const target of outgoing.get(from) ?? []) queue.push(target);
  }
  const unreachable = assessments
    .filter((page) => !reachable.has(normal(page.inventory.url)))
    .map((page) => page.inventory.url);
  if (unreachable.length && assessments[0])
    addFinding(
      assessments[0],
      "navigation_disconnected",
      "ux",
      "P2",
      "Review pages disconnected from observed navigation",
      `${unreachable.length} captured pages were not reachable from the supplied entry through observed internal links. Sitemap-only or deliberate standalone pages may explain this.`,
      "site link graph",
      unreachable.join("; ").slice(0, 1000),
      "Confirm which pages belong in navigation and which are intentionally standalone.",
      [
        "Every required upgraded page is reachable through approved navigation or a documented standalone entry.",
      ],
      "inferred",
    );
  if (assessments.length !== run.requiredPages)
    assessmentGaps.push(
      `${run.requiredPages - assessments.length} captured pages have no accepted assessment.`,
    );
  if (unassessed.size)
    assessmentGaps.push(
      `${unassessed.size} observed internal targets have no accepted page evidence.`,
    );
  for (const page of inventory.filter((page) => page.outcome !== "captured"))
    assessmentGaps.push(
      `${page.outcome}: ${page.url} — ${page.reason || "No accepted capture"}`,
    );
  const uniqueFindings = [
    ...new Map(findings.map((finding) => [finding.id, finding])).values(),
  ].sort(
    (a, b) =>
      a.priority.localeCompare(b.priority) ||
      a.area.localeCompare(b.area) ||
      a.title.localeCompare(b.title),
  );
  for (const finding of uniqueFindings) priorities[finding.priority]++;
  const referenceCaptures = new Map(
    references.map((reference) => [reference.id, reference.captureId]),
  );
  const findingsByPage = new Map<string, Set<string>>(),
    featuresByPage = new Map<string, Set<string>>();
  for (const finding of uniqueFindings)
    for (const reference of finding.evidenceIds) {
      const capture = referenceCaptures.get(reference);
      if (capture) {
        const values = findingsByPage.get(capture) ?? new Set<string>();
        values.add(finding.id);
        findingsByPage.set(capture, values);
      }
    }
  for (const feature of features) {
    const values = featuresByPage.get(feature.captureId) ?? new Set<string>();
    values.add(feature.kind);
    featuresByPage.set(feature.captureId, values);
  }
  const actionGroups = new Map<
    string,
    IntelligenceReport["actionPlan"][number]
  >();
  for (const finding of uniqueFindings) {
    const key = finding.rule + ":" + finding.priority,
      group = actionGroups.get(key) ?? {
        priority: finding.priority,
        title: finding.action,
        why: finding.detail,
        findingIds: [],
        acceptance: finding.acceptance,
      };
    group.findingIds.push(finding.id);
    actionGroups.set(key, group);
  }
  const browserAssessed = assessments.filter(
      (page) => page.browser.status === "observed",
    ).length,
    status =
      snapshot.coverage.complete && assessmentGaps.length === 0
        ? "complete_within_scope"
        : "partial";
  return {
    version: 1,
    runId: run.id,
    snapshotId: run.snapshotId,
    snapshotSha256: run.snapshotSha256,
    createdAt: new Date().toISOString(),
    mode: run.config.mode,
    assessmentVersion: run.config.version,
    status,
    source: {
      captureStartedAt: snapshot.captureStartedAt,
      captureEndedAt: snapshot.captureEndedAt,
      scope: snapshot.scope,
    },
    coverage: {
      ...snapshot.coverage,
      assessed: assessments.length,
      browserAssessed,
      assessmentGaps: [...new Set(assessmentGaps)],
    },
    summary: {
      pages: assessments.length,
      features: features.length,
      assets: assets.size,
      findings: uniqueFindings.length,
      priorities,
      families,
      overview: `${assessments.length} captured pages analysed, ${browserAssessed} browser-assessed, ${features.length} feature observations and ${assets.size} asset references. ${status === "partial" ? "Coverage or inspection gaps remain." : "Public-page assessment finished within the declared scope."}`,
    },
    pages: assessments.map((page) => {
      const effective = page.renderedInventory ?? page.inventory;
      return {
        captureId: page.captureId,
        url: page.inventory.url,
        title: effective.title,
        family: pageFamily(effective),
        counts: effective.counts,
        featureKinds: [...(featuresByPage.get(page.captureId) ?? [])],
        browserStatus: page.browser.status,
        findingIds: [...(findingsByPage.get(page.captureId) ?? [])],
        limits: [
          ...new Set([
            ...page.inventory.limits,
            ...(page.renderedInventory?.limits ?? []),
          ]),
        ],
      };
    }),
    features,
    assets: [...assets.values()],
    designSystem: {
      tokens: [...tokens.values()].sort((a, b) => b.count - a.count),
      components: [...components.values()],
      observedPages: browserAssessed,
      stylesheets: new Set(
        assessments.flatMap((page) =>
          page.browser.resources
            .filter(
              (resource) =>
                resource.type === "stylesheet" && resource.outcome === "loaded",
            )
            .map((resource) => resource.url),
        ),
      ).size,
      limitations: [
        "Tokens describe observed CSS/computed style patterns, not a verified original component library or brand manual.",
        "Viewport/state sampling cannot establish every hidden responsive or interactive state.",
      ],
    },
    navigation: {
      edges,
      unreachable,
      unassessedTargets: [...unassessed],
      excludedTargets: [...excluded],
      complete: unassessed.size === 0 && snapshot.coverage.complete,
    },
    findings: uniqueFindings,
    references: [
      ...new Map(
        references.map((reference) => [reference.id, reference]),
      ).values(),
    ],
    actionPlan: [...actionGroups.values()],
    advice,
    limitations: [
      ...snapshot.scope.limitations,
      "Public observation cannot establish hidden backend behavior, private-account content or the business accuracy of source claims.",
      "Source workflows with side effects were not submitted; integration requirements need owner confirmation.",
      "Asset references, fetched-resource metadata and screenshots are retained. This is not a rights-cleared downloadable copy of every source media file.",
      "No search-ranking, conversion, revenue or objective design-quality improvement has been established.",
      "Automated accessibility and source SEO observations require contextual/manual review; no compliance or ranking guarantee is made.",
    ],
    methodology: {
      rulesVersion: run.config.version,
      browserEnvironment: "guarded_snapshot_replay",
      viewports: run.config.viewports,
      sources: [
        {
          name: "Google Search Central: SEO Starter Guide",
          url: "https://developers.google.com/search/docs/fundamentals/seo-starter-guide",
        },
        {
          name: "Playwright accessibility testing",
          url: "https://playwright.dev/docs/accessibility-testing",
        },
      ],
    },
  };
}
