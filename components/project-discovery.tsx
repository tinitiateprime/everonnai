"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Capture,
  InventoryPage,
  Scan,
  Snapshot,
} from "@/lib/discovery/contracts";
import type { SourcePage } from "@/lib/types";

async function request<T>(
  route: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(route, {
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
    throw new Error(
      result.error || "Discovery could not complete this action.",
    );
  return result;
}
export function ProjectDiscovery({
  projectId,
  sourceUrl,
  canEdit,
}: {
  projectId: string;
  sourceUrl: string | null;
  canEdit: boolean;
}) {
  const base = `/api/platform/projects/${projectId}`;
  const [scans, setScans] = useState<Scan[]>([]),
    [scan, setScan] = useState<Scan | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]),
    [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [pages, setPages] = useState<InventoryPage[]>([]),
    [total, setTotal] = useState(0),
    [offset, setOffset] = useState(0);
  const [evidence, setEvidence] = useState<{
    capture: Capture;
    evidence: { page: SourcePage };
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [partial, setPartial] = useState(false);
  const automatic = useRef(false),
    active = useRef<AbortController | null>(null);
  const scanId = scan?.id,
    scanStatus = scan?.status,
    scanRevision = scan?.revision;
  const refreshLists = useCallback(async () => {
    const [runs, history] = await Promise.all([
      request<{ scans: Scan[] }>(base + "/discovery-runs"),
      request<{ snapshots: Snapshot[] }>(base + "/snapshots"),
    ]);
    setScans(runs.scans);
    setSnapshots(history.snapshots);
    return runs.scans;
  }, [base]);
  useEffect(() => {
    let mounted = true;
    void refreshLists()
      .then((rows) => {
        if (mounted) setScan(rows[0] ?? null);
      })
      .catch((issue) => {
        if (mounted) setError(issue.message);
      });
    return () => {
      mounted = false;
      automatic.current = false;
      active.current?.abort();
    };
  }, [refreshLists]);
  useEffect(() => {
    if (!scanId || scanStatus !== "running") return;
    let mounted = true;
    const timer = setInterval(() => {
      void request<{ scan: Scan }>(`${base}/discovery-runs/${scanId}`)
        .then((result) => {
          if (mounted) setScan(result.scan);
        })
        .catch((issue) => {
          if (mounted) setError(issue.message);
        });
    }, 1500);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [base, scanId, scanStatus]);
  useEffect(() => {
    let mounted = true;
    const route = snapshot
      ? `${base}/snapshots/${snapshot.id}`
      : scanId
        ? `${base}/discovery-runs/${scanId}/pages`
        : null;
    if (route)
      void request<{ pages: InventoryPage[]; total: number }>(
        `${route}?offset=${offset}`,
      )
        .then((result) => {
          if (mounted) {
            setPages(result.pages);
            setTotal(result.total);
          }
        })
        .catch((issue) => {
          if (mounted) setError(issue.message);
        });
    return () => {
      mounted = false;
    };
  }, [base, snapshot, scanId, scanRevision, offset]);
  async function action(work: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await work();
    } catch (issue) {
      if (!(issue instanceof DOMException && issue.name === "AbortError"))
        setError(
          issue instanceof Error ? issue.message : "Discovery action failed.",
        );
    } finally {
      setBusy(false);
    }
  }
  async function continueScan(
    current: Scan,
    options = { extend: false, retrySkipped: false },
  ) {
    automatic.current = true;
    setSnapshot(null);
    setEvidence(null);
    setOffset(0);
    const controller = new AbortController();
    active.current = controller;
    try {
      do {
        setScan({ ...current, status: "running" });
        const result = await request<{ scan: Scan }>(
          `${base}/discovery-runs/${current.id}/batch`,
          options,
          controller.signal,
        );
        current = result.scan;
        setScan(current);
        options = { extend: false, retrySkipped: false };
      } while (
        automatic.current &&
        !current.pauseRequested &&
        current.status === "paused" &&
        current.coverage.canContinue
      );
    } finally {
      automatic.current = false;
      active.current = null;
      await refreshLists();
    }
  }
  async function pause() {
    if (!scan) return;
    automatic.current = false;
    try {
      await request(`${base}/discovery-runs/${scan.id}/pause`, {});
    } catch (issue) {
      setError(
        issue instanceof Error ? issue.message : "Could not pause scan.",
      );
    }
  }
  const live = scan?.status === "running" && (busy || scan.leaseActive);
  const interrupted = scan?.status === "running" && !live;
  return (
    <div className="project-discovery">
      <h3>Website discovery</h3>
      <p>
        Capture public pages and preserve the source evidence for review. A
        finished scan describes coverage within its stated scope; website
        generation and verification follow in later stages.
      </p>
      {sourceUrl && <p className="discovery-url">Source: {sourceUrl}</p>}
      {error && (
        <p className="workspace-alert" role="alert">
          {error}
        </p>
      )}
      {canEdit && (
        <button
          disabled={busy || live || !sourceUrl}
          onClick={() =>
            void action(async () => {
              const result = await request<{ scan: Scan }>(
                base + "/discovery-runs",
                { requestKey: crypto.randomUUID() },
              );
              setScan(result.scan);
              await refreshLists();
              await continueScan(result.scan);
            })
          }
        >
          Start new scan
        </button>
      )}
      {!!scans.length && (
        <label>
          Scan history
          <select
            value={scan?.id ?? ""}
            disabled={busy}
            onChange={(event) => {
              const selected =
                scans.find((row) => row.id === event.target.value) ?? null;
              setScan(selected);
              setSnapshot(null);
              setEvidence(null);
              setOffset(0);
              setPartial(false);
            }}
          >
            {scans.map((row) => (
              <option key={row.id} value={row.id}>
                {new Date(row.createdAt).toLocaleString()} — {row.status}
              </option>
            ))}
          </select>
        </label>
      )}
      {scan && (
        <div className="discovery-status" aria-live="polite">
          <p data-testid="scan-progress">
            <strong>{scan.coverage.captured ?? 0} pages captured</strong> ·{" "}
            {interrupted ? "interrupted — ready to resume" : scan.status} · page
            limit {scan.pageLimit}
          </p>
          <p>
            {scan.coverage.pending ?? 0} pending · {scan.coverage.skipped ?? 0}{" "}
            skipped
          </p>
          {scan.config.evidenceMode === "fixture" && (
            <p>Test fixture evidence</p>
          )}
          {scan.lastError && <p role="status">{scan.lastError}</p>}
          {scan.status === "complete" && (
            <p>
              {scan.coverage.complete
                ? "All discovered pages in this scan's scope were captured."
                : "The scan finished with gaps. Review skipped pages before continuing."}
            </p>
          )}
          {canEdit && (
            <div className="discovery-actions">
              {live ? (
                <button onClick={() => void pause()}>Pause scan</button>
              ) : (
                <>
                  <button
                    disabled={
                      busy ||
                      (scan.status === "complete" && !scan.coverage.canContinue)
                    }
                    onClick={() => void action(() => continueScan(scan))}
                  >
                    Resume scan
                  </button>
                  {scan.status === "limit" && scan.coverage.canExtend && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void action(() =>
                          continueScan(scan, {
                            extend: true,
                            retrySkipped: false,
                          }),
                        )
                      }
                    >
                      Increase page limit
                    </button>
                  )}
                  {!!scan.coverage.skipped && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void action(() =>
                          continueScan(scan, {
                            extend: false,
                            retrySkipped: true,
                          }),
                        )
                      }
                    >
                      Retry skipped pages
                    </button>
                  )}
                </>
              )}
            </div>
          )}
          {!!scan.coverage.warnings?.length && (
            <details>
              <summary>Capture limitations and warnings</summary>
              <ul>
                {scan.coverage.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </details>
          )}
          {canEdit && !live && !interrupted && (
            <>
              <label className="discovery-check">
                <input
                  type="checkbox"
                  checked={partial}
                  onChange={(event) => setPartial(event.target.checked)}
                />
                I acknowledge that this snapshot may have incomplete coverage.
              </label>
              <button
                disabled={busy || !(scan.coverage.captured ?? 0)}
                onClick={() =>
                  void action(async () => {
                    const result = await request<{ snapshot: Snapshot }>(
                      `${base}/discovery-runs/${scan.id}/snapshots`,
                      { allowIncomplete: partial },
                    );
                    setSnapshot(result.snapshot);
                    setOffset(0);
                    setEvidence(null);
                    await refreshLists();
                  })
                }
              >
                Freeze source snapshot
              </button>
            </>
          )}
        </div>
      )}
      <h4>Frozen source snapshots</h4>
      {!snapshots.length ? (
        <p>No snapshots frozen yet.</p>
      ) : (
        <label>
          Review snapshot
          <select
            value={snapshot?.id ?? ""}
            onChange={(event) => {
              setSnapshot(
                snapshots.find((row) => row.id === event.target.value) ?? null,
              );
              setEvidence(null);
              setOffset(0);
            }}
          >
            <option value="">Current scan evidence</option>
            {snapshots.map((row) => (
              <option key={row.id} value={row.id}>
                {new Date(row.createdAt).toLocaleString()} —{" "}
                {row.coverage.captured} pages
                {row.coverage.complete ? "" : " — partial"}
              </option>
            ))}
          </select>
        </label>
      )}
      {snapshot && (
        <div className="discovery-snapshot" data-testid="snapshot-summary">
          <p>
            <strong>Frozen: {snapshot.coverage.captured} pages</strong> ·{" "}
            {snapshot.coverage.complete
              ? "complete within scope"
              : "partial coverage"}
          </p>
          <p>
            Captured from {new Date(snapshot.captureStartedAt).toLocaleString()}{" "}
            to {new Date(snapshot.captureEndedAt).toLocaleString()}.
          </p>
          <p className="discovery-url">
            Manifest SHA-256: {snapshot.manifestSha256}
          </p>
          <details>
            <summary>Snapshot scope</summary>
            <ul>
              {snapshot.scope.limitations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </details>
        </div>
      )}
      {!!total && (
        <>
          <h4>
            {snapshot ? "Snapshot page inventory" : "Scan page inventory"} (
            {total})
          </h4>
          <ul className="discovery-pages">
            {pages.map((page) => (
              <li key={page.url}>
                <div>
                  <strong>{page.title || page.url}</strong>
                  <p className="discovery-url">{page.url}</p>
                  <p>
                    {page.outcome}
                    {page.reason ? ` — ${page.reason}` : ""}
                    {page.capturedAt
                      ? ` · ${new Date(page.capturedAt).toLocaleString()}`
                      : ""}
                  </p>
                </div>
                {snapshot && page.captureId && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void action(async () =>
                        setEvidence(
                          await request(
                            `${base}/snapshots/${snapshot.id}/pages/${page.captureId}`,
                          ),
                        ),
                      )
                    }
                  >
                    Read captured page
                  </button>
                )}
              </li>
            ))}
          </ul>
          {total > 100 && (
            <div className="discovery-actions">
              <button
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - 100))}
              >
                Previous pages
              </button>
              <span>
                {offset + 1}–{Math.min(total, offset + 100)} of {total}
              </span>
              <button
                disabled={offset + 100 >= total}
                onClick={() => setOffset(offset + 100)}
              >
                Next pages
              </button>
            </div>
          )}
        </>
      )}
      {evidence && (
        <div className="discovery-evidence">
          <h4>{evidence.evidence.page.title}</h4>
          <p className="discovery-url">
            Text SHA-256: {evidence.capture.textSha256}
          </p>
          <p>
            Contacts:{" "}
            {[
              ...evidence.evidence.page.emails,
              ...evidence.evidence.page.phones,
            ].join(", ") || "None captured"}
          </p>
          <pre>{evidence.evidence.page.text}</pre>
          <button onClick={() => setEvidence(null)}>Close captured page</button>
        </div>
      )}
    </div>
  );
}
