"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Fact,
  FactSet,
  Blueprint,
  BlueprintDocument,
} from "@/lib/knowledge/contracts";
import type { Snapshot } from "@/lib/discovery/contracts";
import type { Build, BuildVerification } from "@/lib/builds/contracts";
import { ProjectBuildReview } from "./project-build-review";
type Facts = { record: FactSet; document: { facts: Fact[] } };
type Plan = { record: Blueprint; document: BlueprintDocument };
type Lead = {
  id: string;
  name: string;
  email: string;
  message: string;
  createdAt: string;
};
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
  const value = await response.json();
  if (!response.ok)
    throw new Error(value.error || "Could not finish the project action.");
  return value;
}
export function ProjectEngineering({
  projectId,
  alternatives,
  canEdit,
  canReview,
}: {
  projectId: string;
  alternatives: { id: string; slot: number; name: string }[];
  canEdit: boolean;
  canReview: boolean;
}) {
  const base = `/api/platform/projects/${projectId}`;
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]),
    [snapshotId, setSnapshotId] = useState("");
  const [history, setHistory] = useState<{
    facts: FactSet[];
    blueprints: Blueprint[];
  }>({ facts: [], blueprints: [] });
  const [facts, setFacts] = useState<Facts | null>(null),
    [plan, setPlan] = useState<Plan | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [approved, setApproved] = useState(false);
  const [builds, setBuilds] = useState<Build[]>([]),
    [checks, setChecks] = useState<BuildVerification | null>(null),
    [leads, setLeads] = useState<Lead[]>([]);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [pageOffset, setPageOffset] = useState(0),
    [exclusionReason, setExclusionReason] = useState("");
  const continuation = useRef(false),
    controller = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    const [source, knowledge, versions] = await Promise.all([
      api<{ snapshots: Snapshot[] }>(base + "/snapshots"),
      api<typeof history>(base + "/knowledge"),
      api<{ builds: Build[] }>(base + "/builds"),
    ]);
    setSnapshots(source.snapshots);
    setSnapshotId((previous) => previous || source.snapshots[0]?.id || "");
    setHistory(knowledge);
    setBuilds(versions.builds);
  }, [base]);
  useEffect(() => {
    void refresh().catch((issue) => setError(issue.message));
    const timer = setInterval(() => {
      void api<{ snapshots: Snapshot[] }>(base + "/snapshots")
        .then((source) => {
          setSnapshots(source.snapshots);
          setSnapshotId(
            (previous) => previous || source.snapshots[0]?.id || "",
          );
        })
        .catch(() => {});
    }, 5000);
    return () => {
      clearInterval(timer);
      continuation.current = false;
      controller.current?.abort();
    };
  }, [base, refresh]);
  useEffect(() => {
    if (!busy && !builds.some((build) => build.leaseActive)) return;
    const timer = setInterval(() => {
      void api<{ builds: Build[] }>(base + "/builds")
        .then((value) => setBuilds(value.builds))
        .catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [base, busy, builds]);
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (issue) {
      if (!(issue instanceof DOMException && issue.name === "AbortError"))
        setError(issue instanceof Error ? issue.message : "The action failed.");
    } finally {
      setBusy(false);
    }
  }
  async function runCandidate(build: Build) {
    const active = new AbortController();
    controller.current = active;
    while (continuation.current && build.stage < 3) {
      const result = await api<{ build: Build; checks: BuildVerification[] }>(
        `${base}/builds/${build.id}/run`,
        {},
        active.signal,
      );
      build = result.build;
      setBuilds((rows) => [
        build,
        ...rows.filter((row) => row.id !== build.id),
      ]);
      if (result.checks[0]) setChecks(result.checks[0]);
      if (build.status === "failed") break;
    }
    controller.current = null;
    await refresh();
  }
  const factsReady = facts?.record.status === "approved",
    planReady = plan?.record.status === "approved";
  const newest = (alternativeId: string) =>
    builds.find(
      (build) =>
        build.alternativeId === alternativeId &&
        (!planReady || build.blueprintId === plan?.record.id),
    );
  const allReady =
    planReady &&
    alternatives.every(
      (alternative) => newest(alternative.id)?.status === "ready",
    );
  return (
    <div className="project-engineering">
      <h3>Facts, blueprint and complete websites</h3>
      <p>
        Review business facts, account for every source page, then build three
        alternatives from the same approved revisions.
      </p>
      {error && (
        <p className="workspace-alert" role="alert">
          {error}
        </p>
      )}
      <button disabled={busy} onClick={() => void action(refresh)}>
        Refresh source and approvals
      </button>
      <label>
        Frozen source for fact review
        <select
          value={snapshotId}
          disabled={busy}
          onChange={(event) => setSnapshotId(event.target.value)}
        >
          <option value="">Freeze a source snapshot first</option>
          {snapshots.map((snapshot) => (
            <option key={snapshot.id} value={snapshot.id}>
              {snapshot.coverage.captured} pages —{" "}
              {snapshot.coverage.complete ? "complete within scope" : "partial"}{" "}
              — {new Date(snapshot.createdAt).toLocaleString()}
            </option>
          ))}
        </select>
      </label>
      {canEdit && (
        <button
          disabled={busy || !snapshotId}
          onClick={() =>
            void action(async () => {
              const result = await api<{ facts: FactSet }>(
                base + "/fact-sets",
                { snapshotId },
              );
              setFacts(await api(`${base}/fact-sets/${result.facts.id}`));
              setConfirmed(false);
              setPlan(null);
              setApproved(false);
              await refresh();
            })
          }
        >
          Extract business facts
        </button>
      )}
      {!!history.facts.length && (
        <label>
          Fact-set history
          <select
            value={facts?.record.id || ""}
            disabled={busy}
            onChange={(event) =>
              void action(async () => {
                if (!event.target.value) {
                  setFacts(null);
                  setPlan(null);
                  setConfirmed(false);
                  setApproved(false);
                  return;
                }
                setFacts(await api(`${base}/fact-sets/${event.target.value}`));
                setConfirmed(false);
                setPlan(null);
                setApproved(false);
              })
            }
          >
            <option value="">Select a fact-set revision</option>
            {history.facts.map((record) => (
              <option key={record.id} value={record.id}>
                Revision {record.version} — {record.status}
              </option>
            ))}
          </select>
        </label>
      )}
      {facts && (
        <div className="engineering-review">
          <h4>
            Business facts · revision {facts.record.version} ·{" "}
            {facts.record.status}
          </h4>
          <p>
            Source-supported values are evidence, not independent proof. Confirm
            accurate values or omit optional unknowns. Confirmed contact edits
            apply to matching captured contact strings in the approved website
            content.
          </p>
          <fieldset disabled={busy || !canEdit || factsReady}>
            {facts.document.facts.map((fact) => (
              <div key={fact.id}>
                <label>
                  {fact.label}
                  {fact.required ? " (required)" : ""}
                  <input
                    value={fact.value}
                    list={`fact-${fact.id}`}
                    onChange={(event) =>
                      setFacts({
                        ...facts,
                        document: {
                          ...facts.document,
                          facts: facts.document.facts.map((item) =>
                            item.id === fact.id
                              ? { ...item, value: event.target.value }
                              : item,
                          ),
                        },
                      })
                    }
                  />
                  <datalist id={`fact-${fact.id}`}>
                    {fact.candidates.map((value) => (
                      <option key={value} value={value} />
                    ))}
                  </datalist>
                </label>
                <p>
                  {fact.verification} · {fact.evidence.length} source references
                </p>
                {!!fact.evidence.length && (
                  <details>
                    <summary>Source references</summary>
                    <ul>
                      {fact.evidence.map((reference, index) => (
                        <li key={index}>
                          {reference.value} · capture {reference.captureId}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            ))}
            {!factsReady && (
              <label className="discovery-check">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                I reviewed these facts, confirm the entered values, and
                intentionally omit blank optional fields.
              </label>
            )}
          </fieldset>
          {canEdit && !factsReady && (
            <button
              disabled={busy || !confirmed}
              onClick={() =>
                void action(async () => {
                  const result = await api<{ facts: FactSet }>(
                    `${base}/fact-sets/${facts.record.id}/approve`,
                    {
                      decisions: facts.document.facts.map((fact) => ({
                        id: fact.id,
                        value: fact.value,
                        decision: fact.value ? "confirm" : "omit",
                      })),
                    },
                  );
                  setFacts(await api(`${base}/fact-sets/${result.facts.id}`));
                  setPlan(null);
                  setApproved(false);
                  await refresh();
                })
              }
            >
              Approve business facts
            </button>
          )}
          {canEdit && factsReady && (
            <button
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const result = await api<{ blueprint: Blueprint }>(
                    base + "/blueprints",
                    { factSetId: facts.record.id },
                  );
                  setPlan(
                    await api(`${base}/blueprints/${result.blueprint.id}`),
                  );
                  setApproved(false);
                  setPageOffset(0);
                  await refresh();
                })
              }
            >
              Prepare website blueprint
            </button>
          )}
        </div>
      )}
      {!!history.blueprints.length && (
        <label>
          Blueprint history
          <select
            value={plan?.record.id || ""}
            disabled={busy}
            onChange={(event) =>
              void action(async () => {
                if (!event.target.value) {
                  setPlan(null);
                  setApproved(false);
                  return;
                }
                const selected = await api<Plan>(
                  `${base}/blueprints/${event.target.value}`,
                );
                setPlan(selected);
                setFacts(
                  await api(`${base}/fact-sets/${selected.record.factSetId}`),
                );
                setSnapshotId(selected.record.snapshotId);
                setApproved(false);
                setPageOffset(0);
              })
            }
          >
            <option value="">Select a blueprint revision</option>
            {history.blueprints.map((record) => (
              <option key={record.id} value={record.id}>
                Revision {record.version} — {record.status}
              </option>
            ))}
          </select>
        </label>
      )}
      {plan && (
        <div className="engineering-review">
          <h4>
            Website blueprint · revision {plan.record.version} ·{" "}
            {plan.record.status}
          </h4>
          <p>
            {
              plan.document.pages.filter((page) => page.outcome === "render")
                .length
            }{" "}
            rendered pages ·{" "}
            {
              plan.document.pages.filter(
                (page) => page.outcome === "unresolved",
              ).length
            }{" "}
            unresolved ·{" "}
            {
              plan.document.pages.filter((page) => page.outcome === "exclude")
                .length
            }{" "}
            excluded
          </p>
          <p>
            All rendered pages preserve their approved captured content.
            Enquiries use the working project inbox in these private previews.
            Email notifications, booking and public deployment need separate
            configuration.
          </p>
          <p>
            This blueprint uses fact revision{" "}
            {history.facts.find((record) => record.id === plan.record.factSetId)
              ?.version ?? plan.record.factSetId}{" "}
            from snapshot {plan.record.snapshotId}. Changing facts requires a
            new blueprint and new builds.
          </p>
          <p>
            Current generation supports captured text and the enquiry inbox, up
            to 2,000 rendered pages and 32 MB of approved text. Source images
            and advanced widgets need additional implementation. Build archives
            are limited to 64 MB; exceeding a limit blocks completion.
          </p>
          {!planReady &&
            canEdit &&
            plan.document.pages.some(
              (page) => page.outcome === "unresolved",
            ) && (
              <>
                <label>
                  Reason for excluding uncaptured pages
                  <input
                    value={exclusionReason}
                    onChange={(event) => setExclusionReason(event.target.value)}
                  />
                </label>
                <button
                  disabled={busy || !exclusionReason.trim()}
                  onClick={() =>
                    setPlan({
                      ...plan,
                      document: {
                        ...plan.document,
                        pages: plan.document.pages.map((page) =>
                          page.outcome === "unresolved"
                            ? {
                                ...page,
                                outcome: "exclude",
                                reason: exclusionReason.trim(),
                              }
                            : page,
                        ),
                      },
                    })
                  }
                >
                  Explicitly exclude uncaptured pages
                </button>
              </>
            )}
          <fieldset disabled={busy || !canEdit || planReady}>
            <ul className="blueprint-pages">
              {plan.document.pages
                .slice(pageOffset, pageOffset + 50)
                .map((page) => (
                  <li key={page.id}>
                    <strong>{page.title}</strong>
                    <label>
                      Page title
                      <input
                        value={page.title}
                        onChange={(event) =>
                          setPlan({
                            ...plan,
                            document: {
                              ...plan.document,
                              pages: plan.document.pages.map((item) =>
                                item.id === page.id
                                  ? { ...item, title: event.target.value }
                                  : item,
                              ),
                            },
                          })
                        }
                      />
                    </label>
                    <p className="discovery-url">{page.sourceUrl}</p>
                    <label>
                      Website path
                      <input
                        value={page.path}
                        onChange={(event) =>
                          setPlan({
                            ...plan,
                            document: {
                              ...plan.document,
                              pages: plan.document.pages.map((item) =>
                                item.id === page.id
                                  ? { ...item, path: event.target.value }
                                  : item,
                              ),
                            },
                          })
                        }
                      />
                    </label>
                    <label>
                      Page outcome
                      <select
                        value={page.outcome}
                        onChange={(event) =>
                          setPlan({
                            ...plan,
                            document: {
                              ...plan.document,
                              pages: plan.document.pages.map((item) =>
                                item.id === page.id
                                  ? {
                                      ...item,
                                      outcome: event.target
                                        .value as typeof item.outcome,
                                    }
                                  : item,
                              ),
                            },
                          })
                        }
                      >
                        <option value="render" disabled={!page.contentObjectId}>
                          Render complete page
                        </option>
                        <option value="redirect">
                          Redirect to an approved page
                        </option>
                        <option value="exclude">Explicitly exclude</option>
                        <option value="unresolved">
                          Unresolved — blocks approval
                        </option>
                      </select>
                    </label>
                    {page.outcome === "redirect" && (
                      <label>
                        Redirect target
                        <input
                          value={page.target || ""}
                          onChange={(event) =>
                            setPlan({
                              ...plan,
                              document: {
                                ...plan.document,
                                pages: plan.document.pages.map((item) =>
                                  item.id === page.id
                                    ? { ...item, target: event.target.value }
                                    : item,
                                ),
                              },
                            })
                          }
                        />
                      </label>
                    )}
                    {page.outcome === "exclude" && (
                      <label>
                        Exclusion reason
                        <input
                          value={page.reason}
                          onChange={(event) =>
                            setPlan({
                              ...plan,
                              document: {
                                ...plan.document,
                                pages: plan.document.pages.map((item) =>
                                  item.id === page.id
                                    ? { ...item, reason: event.target.value }
                                    : item,
                                ),
                              },
                            })
                          }
                        />
                      </label>
                    )}
                  </li>
                ))}
            </ul>
          </fieldset>
          {plan.document.pages.length > 50 && (
            <div className="discovery-actions">
              <button
                disabled={!pageOffset}
                onClick={() => setPageOffset(Math.max(0, pageOffset - 50))}
              >
                Previous blueprint pages
              </button>
              <span>
                {pageOffset + 1}–
                {Math.min(plan.document.pages.length, pageOffset + 50)}
              </span>
              <button
                disabled={pageOffset + 50 >= plan.document.pages.length}
                onClick={() => setPageOffset(pageOffset + 50)}
              >
                Next blueprint pages
              </button>
            </div>
          )}
          {canEdit && !planReady && (
            <>
              <label className="discovery-check">
                <input
                  type="checkbox"
                  checked={approved}
                  onChange={(event) => setApproved(event.target.checked)}
                />
                I approve these page outcomes and the enquiry inbox scope for
                all three alternatives.
              </label>
              <button
                disabled={
                  busy ||
                  !approved ||
                  plan.document.pages.some(
                    (page) => page.outcome === "unresolved",
                  )
                }
                onClick={() =>
                  void action(async () => {
                    const result = await api<{ blueprint: Blueprint }>(
                      `${base}/blueprints/${plan.record.id}/approve`,
                      {
                        pages: plan.document.pages.map(
                          ({ id, path, title, outcome, target, reason }) => ({
                            id,
                            path,
                            title,
                            outcome,
                            target,
                            reason,
                          }),
                        ),
                      },
                    );
                    setPlan(
                      await api(`${base}/blueprints/${result.blueprint.id}`),
                    );
                    await refresh();
                  })
                }
              >
                Approve website blueprint
              </button>
            </>
          )}
        </div>
      )}
      {canEdit && planReady && (
        <div className="discovery-actions">
          <button
            disabled={busy}
            onClick={() =>
              void action(async () => {
                continuation.current = true;
                for (const alternative of alternatives) {
                  if (!continuation.current) break;
                  const candidate = newest(alternative.id);
                  if (candidate?.status === "ready") continue;
                  const build =
                    candidate ||
                    (
                      await api<{ build: Build }>(base + "/builds", {
                        blueprintId: plan.record.id,
                        alternativeId: alternative.id,
                        requestKey: crypto.randomUUID(),
                      })
                    ).build;
                  await runCandidate(build);
                  if (
                    (await api<{ build: Build }>(`${base}/builds/${build.id}`))
                      .build.status === "failed"
                  )
                    break;
                }
                continuation.current = false;
              })
            }
          >
            Generate three complete websites
          </button>
          {busy && (
            <button
              onClick={() => {
                continuation.current = false;
              }}
            >
              Stop after current stage
            </button>
          )}
        </div>
      )}
      {allReady && (
        <p role="status" className="engineering-success">
          All three websites passed the required checks for this approved
          blueprint.
        </p>
      )}
      <div className="workspace-alternatives">
        {alternatives.map((alternative) => {
          const build = newest(alternative.id);
          return (
            <div key={alternative.id}>
              <strong>{alternative.name}</strong>
              {!build ? (
                <p>No website build yet</p>
              ) : (
                <>
                  <p>
                    Revision {build.revision} ·{" "}
                    {build.status === "ready" ? "Verified" : build.status}
                  </p>
                  {build.inputs.mode === "fixture" && (
                    <p>Test fixture generation</p>
                  )}
                  {build.error && <p>{build.error}</p>}
                  {build.stage >= 2 && (
                    <p>
                      <a
                        href={`${base}/builds/${build.id}/preview/`}
                        target="_blank"
                        rel="noopener"
                      >
                        Open{" "}
                        {build.status === "ready" ? "verified" : "unverified"}{" "}
                        website
                      </a>
                    </p>
                  )}
                  {build.stage >= 2 && (
                    <p>
                      <a href={`${base}/builds/${build.id}/download/source`}>
                        Download Next.js project
                      </a>
                      <br />
                      <a href={`${base}/builds/${build.id}/download/output`}>
                        Download compiled website
                      </a>
                    </p>
                  )}
                  <button
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        const result = await api<{
                          checks: BuildVerification[];
                        }>(`${base}/builds/${build.id}`);
                        setChecks(result.checks[0] || null);
                      })
                    }
                  >
                    Review build checks
                  </button>
                  {canEdit && build.stage < 3 && (
                    <button
                      disabled={busy || build.leaseActive}
                      onClick={() =>
                        void action(async () => {
                          continuation.current = true;
                          await runCandidate(build);
                          continuation.current = false;
                        })
                      }
                    >
                      {build.stage === 2
                        ? "Retry verification"
                        : "Resume website build"}
                    </button>
                  )}
                </>
              )}
              {canEdit && planReady && build && build.stage >= 2 && (
                <button
                  disabled={busy || build.leaseActive}
                  onClick={() =>
                    void action(async () => {
                      continuation.current = true;
                      const result = await api<{ build: Build }>(
                        base + "/builds",
                        {
                          blueprintId: plan.record.id,
                          alternativeId: alternative.id,
                          requestKey: crypto.randomUUID(),
                        },
                      );
                      await runCandidate(result.build);
                      continuation.current = false;
                    })
                  }
                >
                  {build.status === "failed"
                    ? "Generate replacement revision"
                    : "Generate new revision"}
                </button>
              )}
              {!!builds.filter(
                (row) =>
                  row.alternativeId === alternative.id &&
                  row.stage >= 2 &&
                  row.id !== build?.id,
              ).length && (
                <details>
                  <summary>Earlier immutable builds</summary>
                  <ul>
                    {builds
                      .filter(
                        (row) =>
                          row.alternativeId === alternative.id &&
                          row.stage >= 2 &&
                          row.id !== build?.id,
                      )
                      .map((row) => (
                        <li key={row.id}>
                          <a
                            href={`${base}/builds/${row.id}/preview/`}
                            target="_blank"
                            rel="noopener"
                          >
                            Revision {row.revision} · {row.status}
                          </a>
                        </li>
                      ))}
                  </ul>
                </details>
              )}
            </div>
          );
        })}
      </div>
      <ProjectBuildReview
        projectId={projectId}
        builds={builds}
        alternatives={alternatives}
        canReview={canReview}
      />
      {checks && (
        <details open className="engineering-review">
          <summary>
            Exact-build verification · {checks.passed ? "passed" : "blocked"}
          </summary>
          <p className="discovery-url">
            Build {checks.buildId} · seal {checks.sealSha256}
          </p>
          <ul>
            {checks.checks.map((check, index) => (
              <li key={index}>
                {check.key}: {check.outcome} — {check.details}
              </li>
            ))}
          </ul>
        </details>
      )}
      {canEdit && (
        <div className="engineering-review">
          <h4>Project enquiry inbox</h4>
          <button
            disabled={busy}
            onClick={() =>
              void action(async () =>
                setLeads(
                  (await api<{ enquiries: Lead[] }>(base + "/enquiries"))
                    .enquiries,
                ),
              )
            }
          >
            Refresh enquiries
          </button>
          {!leads.length ? (
            <p>
              No preview enquiries loaded. Verification test submissions are
              kept separate.
            </p>
          ) : (
            <ul>
              {leads.map((lead) => (
                <li key={lead.id}>
                  <strong>{lead.name}</strong> · {lead.email}
                  <p>{lead.message}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
