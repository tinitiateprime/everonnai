"use client";
import { useCallback, useEffect, useState } from "react";
import type {
  Advice,
  AdviceCorrection,
  AdviceRevision,
  IntelligenceReport,
} from "@/lib/intelligence/contracts";

async function call<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
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
    throw new Error(result.error || "Growth advice could not be loaded.");
  return result;
}

// Plain-language "how our agent can make your website better" view for a sealed
// report: what the site lacks to attract customers, how the agent will enhance it,
// and the agent prompt. Owner corrections are remembered for this project and
// regenerate the advice as a new immutable revision.
export function GrowthAdvice({
  projectId,
  runId,
  report,
  canEdit,
}: {
  projectId: string;
  runId: string;
  report: IntelligenceReport;
  canEdit: boolean;
}) {
  const base = `/api/platform/projects/${projectId}`;
  const [corrections, setCorrections] = useState<AdviceCorrection[]>([]);
  const [revision, setRevision] = useState<AdviceRevision | null>(null);
  const [advice, setAdvice] = useState<Advice>(report.advice);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  // Corrections open only after the agent has generated a website for this project
  // (at least one build that finished design, compilation and verification).
  const [generated, setGenerated] = useState(false);

  useEffect(() => {
    if (generated) return;
    let mounted = true;
    const check = () =>
      call<{ builds: { status: string }[] }>(`${base}/builds`)
        .then((result) => {
          if (
            mounted &&
            result.builds.some((build) => build.status === "ready")
          )
            setGenerated(true);
        })
        .catch(() => {});
    void check();
    // Builds are generated further down the workspace; pick them up without a reload.
    const timer = setInterval(check, 10000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [base, generated]);

  const load = useCallback(async () => {
    const state = await call<{
      corrections: AdviceCorrection[];
      revisions: AdviceRevision[];
    }>(`${base}/intelligence-runs/${runId}/advice`);
    setCorrections(state.corrections);
    const latest = state.revisions[0];
    if (latest) {
      const detail = await call<{ revision: AdviceRevision; advice: Advice }>(
        `${base}/intelligence-runs/${runId}/advice/${latest.id}`,
      );
      setRevision(detail.revision);
      setAdvice(detail.advice);
    } else {
      setRevision(null);
      setAdvice(report.advice);
    }
  }, [base, runId, report.advice]);

  useEffect(() => {
    load().catch((cause) =>
      setError(cause instanceof Error ? cause.message : "Could not load."),
    );
  }, [load]);

  async function run(label: string, task: () => Promise<void>) {
    setBusy(label);
    setError("");
    try {
      await task();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Request failed.");
    } finally {
      setBusy("");
    }
  }
  const regenerate = async () => {
    const result = await call<{ revision: AdviceRevision; advice: Advice }>(
      `${base}/intelligence-runs/${runId}/advice`,
      { requestKey: crypto.randomUUID() },
    );
    setRevision(result.revision);
    setAdvice(result.advice);
  };
  const growth = advice.growth;
  const active = corrections.filter((item) => !item.withdrawnAt);
  const references = new Map(report.references.map((ref) => [ref.id, ref]));

  return (
    <section className="growth-advice" aria-labelledby="growth-advice-title">
      <h4 id="growth-advice-title">
        How our agent can make your website better
      </h4>
      <p className="growth-meta">
        {advice.status === "available"
          ? `Written by ${advice.model ?? "the configured model"} from this report`
          : `AI advice ${advice.status.replace("_", " ")}`}
        {revision
          ? ` · revision from ${new Date(revision.createdAt).toLocaleString()} using ${revision.correctionIds.length} of your corrections`
          : ""}
      </p>
      {error && (
        <p role="alert" className="workspace-alert">
          {error}
        </p>
      )}
      {growth ? (
        <>
          {advice.summary && <p className="growth-summary">{advice.summary}</p>}
          <h5>What your website is lacking to attract customers</h5>
          <div className="growth-text">{growth.customerGaps}</div>
          <h5>How our agent will enhance your website</h5>
          <div className="growth-text">{growth.enhancementPlan}</div>
          <h5>The prompt our agent will work from</h5>
          <pre className="growth-prompt">{growth.agentPrompt}</pre>
          <button
            type="button"
            onClick={() =>
              void navigator.clipboard
                ?.writeText(growth.agentPrompt)
                .then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                })
                .catch(() => setError("Copy is not available in this browser."))
            }
          >
            {copied ? "Prompt copied" : "Copy prompt"}
          </button>
          {!!growth.evidenceIds.length && (
            <details>
              <summary>
                Evidence behind this advice ({growth.evidenceIds.length})
              </summary>
              <ul>
                {growth.evidenceIds.map((id) => (
                  <li key={id}>
                    <p className="discovery-url">{references.get(id)?.url}</p>
                    {references.get(id)?.observation}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {!!growth.appliedCorrectionIds.length && (
            <p className="growth-meta">
              Applied {growth.appliedCorrectionIds.length} of your corrections.
            </p>
          )}
        </>
      ) : (
        <p>
          {advice.status === "available"
            ? "This report was sealed before plain-language growth advice existed."
            : advice.limitations[0] ||
              "Growth advice is not available for this report."}{" "}
          {canEdit &&
            "Generate it below; the evidence report itself is unchanged."}
        </p>
      )}
      {canEdit && (
        <>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => void run("Writing new advice…", regenerate)}
          >
            {growth ? "Regenerate advice" : "Generate growth advice"}
          </button>
          {!generated && (
            <p className="growth-meta">
              Once the agent has generated your website, you can correct it
              here; your corrections are remembered for all future advice.
            </p>
          )}
          {generated && (
            <form
              className="growth-correction"
              onSubmit={(event) => {
                event.preventDefault();
                void run(
                  "Remembering your correction and updating advice…",
                  async () => {
                    await call(`${base}/advice-corrections`, {
                      body: draft,
                      runId,
                    });
                    setDraft("");
                    await regenerate();
                    await load();
                  },
                );
              }}
            >
              <label>
                Correct the agent
                <textarea
                  rows={3}
                  maxLength={2000}
                  value={draft}
                  disabled={!!busy}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="e.g. We don't offer delivery. Our priority is weekday table bookings, not events."
                />
              </label>
              <p className="growth-meta">
                Corrections are remembered for this project and used in all
                future advice.
              </p>
              <button
                type="submit"
                disabled={!!busy || draft.trim().length < 3}
              >
                Save correction and update advice
              </button>
            </form>
          )}
        </>
      )}
      {busy && <p role="status">{busy}</p>}
      {!!active.length && (
        <details>
          <summary>What the agent remembers ({active.length})</summary>
          <ul className="growth-memory">
            {active.map((item) => (
              <li key={item.id}>
                <p>{item.body}</p>
                <small>{new Date(item.createdAt).toLocaleString()}</small>
                {canEdit && (
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() =>
                      void run("Removing correction…", async () => {
                        await call(
                          `${base}/advice-corrections/${item.id}/withdraw`,
                          {},
                        );
                        await load();
                      })
                    }
                  >
                    Forget
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {advice.limitations.map((limit, index) => (
        <p key={index} className="growth-meta">
          {limit}
        </p>
      ))}
    </section>
  );
}
