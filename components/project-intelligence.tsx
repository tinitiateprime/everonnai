"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  IntelligenceRun,
  IntelligenceReport,
  PageAssessment,
} from "@/lib/intelligence/contracts";
import type { Scan, Snapshot } from "@/lib/discovery/contracts";
async function api<T>(
  url: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    signal,
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Website inspection could not finish.");
  return result;
}
export function ProjectIntelligence({
  projectId,
  sourceUrl,
  canEdit,
}: {
  projectId: string;
  sourceUrl: string | null;
  canEdit: boolean;
}) {
  const base = `/api/platform/projects/${projectId}`;
  const [runs, setRuns] = useState<IntelligenceRun[]>([]),
    [run, setRun] = useState<IntelligenceRun | null>(null),
    [report, setReport] = useState<IntelligenceReport | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]),
    [snapshotId, setSnapshotId] = useState(""),
    [sourceScan, setSourceScan] = useState<Scan | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [progress, setProgress] = useState(""),
    [partial, setPartial] = useState(false);
  const [tab, setTab] = useState("overview"),
    [filter, setFilter] = useState(""),
    [pageOffset, setPageOffset] = useState(0),
    [assessment, setAssessment] = useState<PageAssessment | null>(null);
  const continuing = useRef(false),
    controller = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    const [history, sources, scans] = await Promise.all([
      api<{ runs: IntelligenceRun[] }>(base + "/intelligence-runs"),
      api<{ snapshots: Snapshot[] }>(base + "/snapshots"),
      api<{ scans: Scan[] }>(base + "/discovery-runs"),
    ]);
    setRuns(history.runs);
    setSnapshots(sources.snapshots);
    setSnapshotId((value) => value || sources.snapshots[0]?.id || "");
    setSourceScan(
      scans.scans.find((scan) => scan.status !== "complete") ?? null,
    );
    return history.runs;
  }, [base]);
  useEffect(() => {
    let active = true;
    void refresh()
      .then(async (history) => {
        if (!active) return;
        setRun(history[0] ?? null);
        if (history[0]?.reportObjectId) {
          const result = await api<{ report: IntelligenceReport }>(
            `${base}/intelligence-runs/${history[0].id}/report`,
          );
          if (active) setReport(result.report);
        }
      })
      .catch((issue) => {
        if (active) setError(issue.message);
      });
    return () => {
      active = false;
      continuing.current = false;
      controller.current?.abort();
    };
  }, [base, refresh]);
  useEffect(() => {
    if (!run || !run.leaseActive) return;
    const id = run.id;
    const timer = setInterval(
      () =>
        void api<{ run: IntelligenceRun }>(`${base}/intelligence-runs/${id}`)
          .then((result) => setRun(result.run))
          .catch(() => {}),
      3000,
    );
    return () => clearInterval(timer);
  }, [base, run]);
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (issue) {
      if (!(issue instanceof DOMException && issue.name === "AbortError"))
        setError(issue instanceof Error ? issue.message : "Inspection failed.");
    } finally {
      continuing.current = false;
      controller.current = null;
      setBusy(false);
      void refresh().catch(() => {});
    }
  }
  async function inspect(current: IntelligenceRun, signal: AbortSignal) {
    setRun(current);
    setReport(null);
    setAssessment(null);
    while (continuing.current && current.stage < 2) {
      setProgress(
        current.stage === 0
          ? `Analysing page evidence: ${current.processedPages} / ${current.requiredPages}.`
          : `Preparing the site-wide audit and improvement plan.`,
      );
      const result = await api<{ run: IntelligenceRun }>(
        `${base}/intelligence-runs/${current.id}/batch`,
        {},
        signal,
      );
      current = result.run;
      setRun(current);
      if (current.status === "failed")
        throw new Error(
          current.error ||
            "The analysis batch failed. Resume accepted progress.",
        );
    }
    if (current.reportObjectId) {
      const result = await api<{ report: IntelligenceReport }>(
        `${base}/intelligence-runs/${current.id}/report`,
      );
      setReport(result.report);
      setProgress(
        "Report prepared. Review its coverage, evidence and action plan.",
      );
      setTab("overview");
      setFilter("");
      setPageOffset(0);
    }
  }
  async function fromSnapshot(id: string, signal: AbortSignal) {
    const result = await api<{ run: IntelligenceRun }>(
      base + "/intelligence-runs",
      { snapshotId: id, requestKey: crypto.randomUUID() },
      signal,
    );
    await inspect(result.run, signal);
  }
  async function fromUrl(resume: boolean) {
    const active = new AbortController();
    controller.current = active;
    continuing.current = true;
    setReport(null);
    setAssessment(null);
    let scan =
      resume && sourceScan
        ? sourceScan
        : (
            await api<{ scan: Scan }>(
              base + "/discovery-runs",
              { requestKey: crypto.randomUUID() },
              active.signal,
            )
          ).scan;
    setSourceScan(scan);
    while (continuing.current && scan.status !== "complete") {
      if (scan.leaseActive)
        throw new Error(
          "Discovery is running in another request. Resume when its current batch finishes.",
        );
      const extend = scan.status === "limit" && !!scan.coverage.canExtend;
      if (
        !extend &&
        !scan.coverage.canContinue &&
        scan.coverage.captured !== undefined
      )
        break;
      setProgress(
        `Discovering pages: ${scan.coverage.captured || 0} captured; ${scan.coverage.pending || 0} pending.`,
      );
      scan = (
        await api<{ scan: Scan }>(
          `${base}/discovery-runs/${scan.id}/batch`,
          { extend },
          active.signal,
        )
      ).scan;
      setSourceScan(scan);
      if (scan.status === "failed")
        throw new Error(
          scan.lastError ||
            "Discovery failed. Accepted pages remain available.",
        );
    }
    if (!continuing.current) return;
    if (!scan.coverage.captured)
      throw new Error("No captured source pages are available for analysis.");
    if (!scan.coverage.complete && !partial)
      throw new Error(
        "Some source pages remain unread or inaccessible. Review discovery coverage, retry available pages, or explicitly allow a partial-source report below.",
      );
    const result = await api<{ snapshot: Snapshot }>(
      `${base}/discovery-runs/${scan.id}/snapshots`,
      { allowIncomplete: partial },
      active.signal,
    );
    setSnapshotId(result.snapshot.id);
    await fromSnapshot(result.snapshot.id, active.signal);
  }
  const referenceMap = new Map(
      report?.references.map((reference) => [reference.id, reference]) ?? [],
    ),
    tabs = ["overview", "pages", "features", "design", "findings", "plan"];
  const visible =
    report?.findings.filter((finding) =>
      `${finding.title} ${finding.area} ${finding.priority} ${finding.detail}`
        .toLowerCase()
        .includes(filter.toLowerCase()),
    ) ?? [];
  return (
    <div className="project-intelligence">
      <h3>Website intelligence and improvement report</h3>
      <p>
        Inspect the public website, understand its pages, features and visual
        system, and receive an evidence-linked UX, SEO and feature action plan.
      </p>
      {sourceUrl && <p className="discovery-url">{sourceUrl}</p>}
      {error && (
        <p role="alert" className="workspace-alert">
          {error}
        </p>
      )}
      {progress && <p role="status">{progress}</p>}
      <button
        disabled={busy}
        onClick={() =>
          void action(async () => {
            await refresh();
          })
        }
      >
        Refresh inspection sources and history
      </button>
      {canEdit && (
        <>
          <div className="discovery-actions">
            <button
              disabled={busy || !sourceUrl || !!run?.leaseActive}
              onClick={() => void action(() => fromUrl(false))}
            >
              Inspect website and create report
            </button>
            {sourceScan && (
              <button
                disabled={busy || sourceScan.leaseActive}
                onClick={() => void action(() => fromUrl(true))}
              >
                Resume discovery for report
              </button>
            )}
            {run && run.stage < 2 && (
              <button
                disabled={busy || run.leaseActive}
                onClick={() =>
                  void action(async () => {
                    const active = new AbortController();
                    controller.current = active;
                    continuing.current = true;
                    await inspect(run, active.signal);
                  })
                }
              >
                Resume website analysis
              </button>
            )}
            {busy && (
              <button
                onClick={() => {
                  continuing.current = false;
                }}
              >
                Stop after current batch
              </button>
            )}
          </div>
          <label className="discovery-check">
            <input
              type="checkbox"
              checked={partial}
              disabled={busy}
              onChange={(event) => setPartial(event.target.checked)}
            />
            Allow a partial-source report if pages cannot be captured; display
            every coverage gap.
          </label>
          <label>
            Existing frozen source for analysis
            <select
              value={snapshotId}
              disabled={busy}
              onChange={(event) => setSnapshotId(event.target.value)}
            >
              <option value="">Choose a frozen snapshot</option>
              {snapshots.map((snapshot) => (
                <option key={snapshot.id} value={snapshot.id}>
                  {snapshot.coverage.captured} captured pages ·{" "}
                  {snapshot.coverage.complete
                    ? "complete within scope"
                    : "partial"}{" "}
                  · {new Date(snapshot.createdAt).toLocaleString()}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={busy || !snapshotId}
            onClick={() =>
              void action(async () => {
                const active = new AbortController();
                controller.current = active;
                continuing.current = true;
                await fromSnapshot(snapshotId, active.signal);
              })
            }
          >
            Analyse frozen source
          </button>
        </>
      )}
      {!!runs.length && (
        <label>
          Intelligence report history
          <select
            value={run?.id || ""}
            disabled={busy}
            onChange={(event) =>
              void action(async () => {
                const selected =
                  runs.find((run) => run.id === event.target.value) ?? null;
                setRun(selected);
                setReport(
                  selected?.reportObjectId
                    ? (
                        await api<{ report: IntelligenceReport }>(
                          `${base}/intelligence-runs/${selected.id}/report`,
                        )
                      ).report
                    : null,
                );
                setAssessment(null);
              })
            }
          >
            <option value="">Select an inspection</option>
            {runs.map((run) => (
              <option key={run.id} value={run.id}>
                {new Date(run.createdAt).toLocaleString()} · {run.status} ·{" "}
                {run.processedPages}/{run.requiredPages} pages
                {run.config.mode === "fixture" ? " · fixture" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {run && !report && (
        <p>
          Accepted assessments: {run.processedPages} / {run.requiredPages}.
          Browser assessed: {run.browserPages}. {run.status}. {run.error}
        </p>
      )}
      {report && (
        <>
          <div className="intelligence-summary">
            <strong>
              {report.status === "partial"
                ? "Report prepared with coverage gaps"
                : "Public-site assessment complete within scope"}
            </strong>
            <p>{report.summary.overview}</p>
            {report.mode === "fixture" && (
              <p>Test fixture source/design evidence.</p>
            )}
            <p>
              {report.summary.priorities.P1} high-priority findings ·{" "}
              {report.designSystem.stylesheets} observed stylesheets ·{" "}
              {Object.keys(report.summary.families).length} page families.
            </p>
            <a
              href={`${base}/intelligence-runs/${report.runId}/report?download=1`}
            >
              Download complete evidence report (JSON)
            </a>
          </div>
          <div
            className="intelligence-tabs"
            role="tablist"
            aria-label="Website intelligence report"
          >
            {tabs.map((value) => (
              <button
                key={value}
                role="tab"
                aria-selected={tab === value}
                aria-controls={`intelligence-${value}`}
                id={`intelligence-tab-${value}`}
                onClick={() => {
                  setTab(value);
                  setPageOffset(0);
                  setFilter("");
                }}
              >
                {value === "plan"
                  ? "Improvement plan"
                  : value[0].toUpperCase() + value.slice(1)}
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            id={`intelligence-${tab}`}
            aria-labelledby={`intelligence-tab-${tab}`}
            className="intelligence-content"
          >
            {tab === "overview" && (
              <>
                <h4>What is on this website</h4>
                <p>
                  {report.summary.pages} pages · {report.summary.features}{" "}
                  feature observations · {report.summary.assets} media/resource
                  references.
                </p>
                <ul>
                  {Object.entries(report.summary.families).map(
                    ([family, count]) => (
                      <li key={family}>
                        {family}: {count} pages
                      </li>
                    ),
                  )}
                </ul>
                <h4>Coverage and confidence</h4>
                <p>
                  {report.coverage.captured} / {report.coverage.discovered}{" "}
                  discovered URLs captured. {report.coverage.browserAssessed} /{" "}
                  {report.coverage.captured} browser assessed.
                </p>
                {report.coverage.assessmentGaps.length ? (
                  <ul>
                    {report.coverage.assessmentGaps
                      .slice(0, 100)
                      .map((gap, index) => (
                        <li key={index}>{gap}</li>
                      ))}
                  </ul>
                ) : (
                  <p>No recorded coverage gaps within this inspection scope.</p>
                )}
                <p>
                  Feature presence does not prove backend success. Original
                  forms, booking, checkout and account actions were not
                  submitted.
                </p>
                <h4>Report boundaries</h4>
                <ul>
                  {report.limitations.map((limit, index) => (
                    <li key={index}>{limit}</li>
                  ))}
                </ul>
                <h4>Methodology</h4>
                <p>
                  {report.assessmentVersion} · guarded snapshot replay at{" "}
                  {report.methodology.viewports.join(", ")} pixels. Public
                  assets may have changed since their HTML capture.
                </p>
                {report.methodology.sources.map((source) => (
                  <p key={source.url}>
                    <a href={source.url} target="_blank" rel="noopener">
                      {source.name}
                    </a>
                  </p>
                ))}
              </>
            )}
            {tab === "pages" && (
              <>
                <h4>Page and content inventory</h4>
                <ul className="intelligence-list">
                  {report.pages
                    .slice(pageOffset, pageOffset + 50)
                    .map((page) => (
                      <li key={page.captureId}>
                        <strong>{page.title || page.url}</strong>
                        <p className="discovery-url">{page.url}</p>
                        <p>
                          {page.family} · {page.counts.words} observed words ·{" "}
                          {page.counts.sections} regions · {page.counts.forms}{" "}
                          forms · {page.browserStatus}.
                        </p>
                        <p>
                          Features:{" "}
                          {page.featureKinds.join(", ") ||
                            "No supported feature markers observed"}
                          .
                        </p>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void action(async () =>
                              setAssessment(
                                (
                                  await api<{ assessment: PageAssessment }>(
                                    `${base}/intelligence-runs/${report.runId}/pages/${page.captureId}`,
                                  )
                                ).assessment,
                              ),
                            )
                          }
                        >
                          Inspect page evidence
                        </button>
                      </li>
                    ))}
                </ul>
                <div className="discovery-actions">
                  <button
                    disabled={!pageOffset}
                    onClick={() => setPageOffset(Math.max(0, pageOffset - 50))}
                  >
                    Previous inventory pages
                  </button>
                  <span>
                    {Math.min(pageOffset + 1, report.pages.length)}–
                    {Math.min(pageOffset + 50, report.pages.length)} /{" "}
                    {report.pages.length}
                  </span>
                  <button
                    disabled={pageOffset + 50 >= report.pages.length}
                    onClick={() => setPageOffset(pageOffset + 50)}
                  >
                    Next inventory pages
                  </button>
                </div>
              </>
            )}
            {tab === "features" && (
              <>
                <h4>Features and integration requirements</h4>
                <p>
                  Observed means a concrete UI/markup marker was captured.
                  Inferred classifications require review. Backend behavior
                  remains untested.
                </p>
                <ul className="intelligence-list">
                  {report.features
                    .slice(pageOffset, pageOffset + 50)
                    .map((feature) => (
                      <li key={feature.id + feature.url}>
                        <strong>
                          {feature.kind} · {feature.label}
                        </strong>
                        <p>
                          {feature.confidence} · backend: {feature.backend}
                        </p>
                        <p className="discovery-url">{feature.url}</p>
                        <details>
                          <summary>Observed configuration</summary>
                          <ul>
                            {Object.entries(feature.details).map(
                              ([key, value]) => (
                                <li key={key}>
                                  {key}:{" "}
                                  {Array.isArray(value)
                                    ? value.join(", ")
                                    : String(value)}
                                </li>
                              ),
                            )}
                          </ul>
                        </details>
                      </li>
                    ))}
                </ul>
                <div className="discovery-actions">
                  <button
                    disabled={!pageOffset}
                    onClick={() => setPageOffset(Math.max(0, pageOffset - 50))}
                  >
                    Previous features
                  </button>
                  <span>
                    {Math.min(pageOffset + 1, report.features.length)}–
                    {Math.min(pageOffset + 50, report.features.length)} /{" "}
                    {report.features.length}
                  </span>
                  <button
                    disabled={pageOffset + 50 >= report.features.length}
                    onClick={() => setPageOffset(pageOffset + 50)}
                  >
                    Next features
                  </button>
                </div>
              </>
            )}
            {tab === "design" && (
              <>
                <h4>Observed visual system and components</h4>
                <p>
                  {report.designSystem.observedPages} browser-assessed pages ·{" "}
                  {report.designSystem.stylesheets} stylesheets. Tokens reflect
                  captured declarations and sampled computed styles.
                </p>
                <ul>
                  {report.designSystem.components.map((component) => (
                    <li key={component.kind}>
                      {component.kind}: {component.count} observations across{" "}
                      {component.pages.length} pages.
                    </li>
                  ))}
                </ul>
                <div className="intelligence-token-grid">
                  {report.designSystem.tokens
                    .slice(pageOffset, pageOffset + 60)
                    .map((token, index) => (
                      <div key={index}>
                        <strong>
                          {token.kind} · {token.name}
                        </strong>
                        <p className="discovery-url">{token.value}</p>
                        <small>
                          {token.pageUrls.length} pages · {token.count}{" "}
                          observations
                        </small>
                      </div>
                    ))}
                </div>
                <div className="discovery-actions">
                  <button
                    disabled={!pageOffset}
                    onClick={() => setPageOffset(Math.max(0, pageOffset - 60))}
                  >
                    Previous design tokens
                  </button>
                  <span>
                    {Math.min(
                      pageOffset + 60,
                      report.designSystem.tokens.length,
                    )}{" "}
                    / {report.designSystem.tokens.length}
                  </span>
                  <button
                    disabled={
                      pageOffset + 60 >= report.designSystem.tokens.length
                    }
                    onClick={() => setPageOffset(pageOffset + 60)}
                  >
                    Next design tokens
                  </button>
                </div>
                <h4>Media/resource inventory</h4>
                <ul>
                  {report.assets.slice(0, 40).map((asset) => (
                    <li key={asset.kind + asset.url}>
                      <strong>{asset.kind}</strong> ·{" "}
                      <span className="discovery-url">{asset.url}</span> ·{" "}
                      {asset.pages.length} pages
                    </li>
                  ))}
                </ul>
                <p>
                  The full media inventory is in the report download. Source
                  assets are not automatically cleared for reuse.
                </p>
              </>
            )}
            {tab === "findings" && (
              <>
                <h4>UX, SEO, accessibility and feature findings</h4>
                <label>
                  Filter audit findings
                  <input
                    value={filter}
                    onChange={(event) => {
                      setFilter(event.target.value);
                      setPageOffset(0);
                    }}
                    placeholder="For example: P1, SEO, forms"
                  />
                </label>
                <ul className="intelligence-list">
                  {visible.slice(pageOffset, pageOffset + 40).map((finding) => (
                    <li key={finding.id}>
                      <strong>
                        {finding.priority} · {finding.area} · {finding.title}
                      </strong>
                      <p>
                        {finding.kind}: {finding.detail}
                      </p>
                      <p>{finding.action}</p>
                      <details>
                        <summary>Evidence and acceptance checks</summary>
                        <ul>
                          {finding.evidenceIds.map((id) => {
                            const ref = referenceMap.get(id);
                            return (
                              <li key={id}>
                                <p className="discovery-url">
                                  {ref?.url} · {ref?.locator}
                                </p>
                                <p>
                                  {ref?.observation ||
                                    "Evidence reference unavailable"}
                                </p>
                              </li>
                            );
                          })}
                        </ul>
                        <ul>
                          {finding.acceptance.map((check, index) => (
                            <li key={index}>{check}</li>
                          ))}
                        </ul>
                      </details>
                    </li>
                  ))}
                </ul>
                <div className="discovery-actions">
                  <button
                    disabled={!pageOffset}
                    onClick={() => setPageOffset(Math.max(0, pageOffset - 40))}
                  >
                    Previous findings
                  </button>
                  <span>
                    {Math.min(pageOffset + 40, visible.length)} /{" "}
                    {visible.length}
                  </span>
                  <button
                    disabled={pageOffset + 40 >= visible.length}
                    onClick={() => setPageOffset(pageOffset + 40)}
                  >
                    Next findings
                  </button>
                </div>
              </>
            )}
            {tab === "plan" && (
              <>
                <h4>What to improve and how to verify it</h4>
                <p>
                  This is a proposed upgrade plan. Findings and owner decisions
                  become requirements before a future build changes the website.
                </p>
                <ol className="intelligence-list">
                  {report.actionPlan.map((action, index) => (
                    <li key={index}>
                      <strong>
                        {action.priority} · {action.title}
                      </strong>
                      <p>
                        {action.why} · {action.findingIds.length} supporting
                        findings.
                      </p>
                      <ul>
                        {action.acceptance.map((check, index) => (
                          <li key={index}>{check}</li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ol>
                <h4>AI review proposals · {report.advice.status}</h4>
                <p>{report.advice.summary}</p>
                <ul className="intelligence-list">
                  {report.advice.recommendations.map((item, index) => (
                    <li key={index}>
                      <strong>
                        {item.priority} · {item.title}
                      </strong>
                      <p>{item.why}</p>
                      <ul>
                        {item.acceptance.map((check, index) => (
                          <li key={index}>{check}</li>
                        ))}
                      </ul>
                      <details>
                        <summary>Cited observations</summary>
                        <ul>
                          {item.evidenceIds.map((id) => (
                            <li key={id}>
                              <p className="discovery-url">
                                {referenceMap.get(id)?.url}
                              </p>
                              {referenceMap.get(id)?.observation}
                            </li>
                          ))}
                        </ul>
                      </details>
                    </li>
                  ))}
                </ul>
                {report.advice.limitations.map((limit, index) => (
                  <p key={index}>{limit}</p>
                ))}
              </>
            )}
          </div>
          {assessment && (
            <details open className="engineering-review">
              <summary>
                Page detail ·{" "}
                {assessment.renderedInventory?.title ||
                  assessment.inventory.title ||
                  assessment.inventory.url}
              </summary>
              <p className="discovery-url">{assessment.inventory.url}</p>
              <p>
                Language: {assessment.inventory.language || "not declared"} ·
                canonical: {assessment.inventory.canonical || "not declared"} ·
                robots: {assessment.inventory.robots || "no explicit directive"}
                .
              </p>
              <h4>Captured business data, awaiting owner confirmation</h4>
              <ul>
                {Object.entries(
                  (assessment.renderedInventory ?? assessment.inventory)
                    .businessData,
                ).map(([key, value]) => (
                  <li key={key}>
                    <strong>{key}</strong>:{" "}
                    {key === "structuredFacts"
                      ? (value as { path: string; value: string }[]).length +
                        " structured source facts"
                      : (value as string[]).join("; ") || "not observed"}
                  </li>
                ))}
              </ul>
              <h4>Content regions</h4>
              {assessment.inventory.sections
                .slice(0, 30)
                .map((section, index) => (
                  <details key={index}>
                    <summary>
                      {section.kind} · {section.heading || "Untitled region"} ·{" "}
                      {section.wordCount} words
                    </summary>
                    <p>{section.text}</p>
                  </details>
                ))}
              <p>
                <a
                  href={`${base}/snapshots/${report.snapshotId}/pages/${assessment.captureId}`}
                  target="_blank"
                  rel="noopener"
                >
                  Open complete captured text evidence (JSON)
                </a>
              </p>
              <h4>Observed layouts</h4>
              <div className="intelligence-screenshots">
                {assessment.browser.viewports
                  .filter((view) => view.screenshotObjectId)
                  .map((view) => (
                    <a
                      key={view.width}
                      href={`${base}/intelligence-runs/${report.runId}/pages/${assessment.captureId}/screenshots/${view.width}`}
                      target="_blank"
                      rel="noopener"
                    >
                      <span>
                        {view.width}px · {view.overflowPixels}px overflow
                      </span>
                      {/* Captured third-party layout; native image avoids image optimizer fetches. */}
                      <img
                        alt={`Observed source layout at ${view.width}px`}
                        src={`${base}/intelligence-runs/${report.runId}/pages/${assessment.captureId}/screenshots/${view.width}`}
                      />
                    </a>
                  ))}
              </div>
              <p>
                Browser environment: snapshot replay with guarded public asset
                requests. Backend workflows were not submitted.
              </p>
            </details>
          )}
        </>
      )}
    </div>
  );
}
