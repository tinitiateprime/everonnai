"use client";
import { useEffect, useRef, useState } from "react";
import type { Build } from "@/lib/builds/contracts";
import type { BuildReport, BuildReview } from "@/lib/builds/review-contracts";
const items = {
  brandAndLayout: "Brand, layout and visual hierarchy",
  contentAndFacts: "Page content and approved business facts",
  mobileAndKeyboard: "Mobile layout and keyboard use",
  featuresAndLimitations: "Working enquiry form and disclosed limitations",
  distinctAlternatives: "Meaningful differences from the other alternatives",
};
const empty = () =>
  Object.fromEntries(
    Object.keys(items).map((key) => [key, false]),
  ) as BuildReview["checklist"];
async function api<T>(url: string, body?: unknown): Promise<T> {
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
    throw new Error(result.error || "Could not load the review.");
  return result;
}
export function ProjectBuildReview({
  projectId,
  builds,
  alternatives,
  canReview,
}: {
  projectId: string;
  builds: Build[];
  alternatives: { id: string; name: string }[];
  canReview: boolean;
}) {
  const base = `/api/platform/projects/${projectId}`;
  const [reviews, setReviews] = useState<BuildReview[]>([]),
    [selected, setSelected] = useState("");
  const [report, setReport] = useState<BuildReport | null>(null),
    [checklist, setChecklist] = useState(empty),
    [notes, setNotes] = useState(""),
    [decision, setDecision] = useState<BuildReview["decision"]>("approved");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const request = useRef<{ signature: string; key: string } | null>(null);
  const identity = builds
    .map((build) => `${build.id}:${build.status}`)
    .join(",");
  useEffect(() => {
    let active = true;
    void api<{ reviews: BuildReview[] }>(base + "/build-reviews")
      .then((result) => {
        if (active) setReviews(result.reviews);
      })
      .catch((issue) => {
        if (active) setError(issue.message);
      });
    return () => {
      active = false;
    };
  }, [base, identity]);
  const candidates = builds.filter((build) => build.stage >= 2);
  const build = candidates.find((build) => build.id === selected),
    review = reviews.find(
      (review) =>
        review.buildId === build?.id && review.sealSha256 === build.sealSha256,
    );
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "The review failed.");
    } finally {
      setBusy(false);
    }
  }
  if (!candidates.length) return null;
  return (
    <div className="engineering-review">
      <h4>Website review and comparison</h4>
      <p>
        Automated verification and your design review are recorded separately.
        Review approval applies to this exact preview; production publication
        needs its own deployment and release approval.
      </p>
      {error && (
        <p role="alert" className="workspace-alert">
          {error}
        </p>
      )}
      <label>
        Website build to review
        <select
          value={selected}
          disabled={busy}
          onChange={(event) => {
            setSelected(event.target.value);
            setReport(null);
            setChecklist(empty());
            setNotes("");
            setDecision("approved");
            request.current = null;
          }}
        >
          <option value="">Select a compiled website</option>
          {candidates.map((build) => (
            <option key={build.id} value={build.id}>
              {
                alternatives.find((item) => item.id === build.alternativeId)
                  ?.name
              }{" "}
              · revision {build.revision} · {build.status}
              {build.inputs.mode === "fixture" ? " · test fixture" : ""}
            </option>
          ))}
        </select>
      </label>
      {build && (
        <>
          <p>
            Latest human review: {review?.decision || "pending"}
            {review ? ` — ${review.notes}` : ""}
          </p>
          <p>
            <a
              href={`${base}/builds/${build.id}/preview/`}
              target="_blank"
              rel="noopener"
            >
              Inspect selected website
            </a>
          </p>
          <button
            disabled={busy}
            onClick={() =>
              void action(async () =>
                setReport(
                  (
                    await api<{ report: BuildReport }>(
                      `${base}/builds/${build.id}/report`,
                    )
                  ).report,
                ),
              )
            }
          >
            View evidence and comparison
          </button>{" "}
          <a href={`${base}/builds/${build.id}/report?download=1`}>
            Download comparison report
          </a>
          {canReview && build.status === "ready" && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void action(async () => {
                  const payload = {
                    sealSha256: build.sealSha256,
                    decision,
                    notes,
                    checklist,
                  };
                  const signature = JSON.stringify(payload);
                  if (request.current?.signature !== signature)
                    request.current = { signature, key: crypto.randomUUID() };
                  await api(`${base}/builds/${build.id}/review`, {
                    ...payload,
                    requestKey: request.current.key,
                  });
                  setReviews(
                    (
                      await api<{ reviews: BuildReview[] }>(
                        base + "/build-reviews",
                      )
                    ).reviews,
                  );
                  if (report)
                    setReport(
                      (
                        await api<{ report: BuildReport }>(
                          `${base}/builds/${build.id}/report`,
                        )
                      ).report,
                    );
                  request.current = null;
                });
              }}
            >
              <fieldset disabled={busy}>
                <legend>Review this exact website</legend>
                {Object.entries(items).map(([key, label]) => (
                  <label className="discovery-check" key={key}>
                    <input
                      type="checkbox"
                      checked={checklist[key as keyof typeof checklist]}
                      onChange={(event) =>
                        setChecklist({
                          ...checklist,
                          [key]: event.target.checked,
                        })
                      }
                    />
                    {label}
                  </label>
                ))}
                <label>
                  Review decision
                  <select
                    value={decision}
                    onChange={(event) =>
                      setDecision(event.target.value as BuildReview["decision"])
                    }
                  >
                    <option value="approved">Approve preview design</option>
                    <option value="changes_requested">Request changes</option>
                  </select>
                </label>
                <label>
                  Review notes
                  <textarea
                    required
                    minLength={10}
                    maxLength={5000}
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                  />
                </label>
                <button
                  disabled={
                    busy ||
                    notes.trim().length < 10 ||
                    (decision === "approved" &&
                      !Object.values(checklist).every(Boolean))
                  }
                >
                  Record website review
                </button>
              </fieldset>
            </form>
          )}
        </>
      )}
      {report && (
        <div>
          <p>
            {report.coverage.exportedPages} of {report.coverage.requiredPages}{" "}
            required pages · {report.coverage.approvedRedirects} approved
            redirects · {report.coverage.explicitExclusions} explicit
            exclusions.
          </p>
          <p>
            Source captured: {report.source.coverage.captured} of{" "}
            {report.source.coverage.discovered} discovered URLs.{" "}
            {report.source.coverage.complete
              ? "Complete within scan scope."
              : "Partial source snapshot."}
          </p>
          <p>
            Automated preview checks:{" "}
            {report.previewVerified ? "passed" : "blocked"}. Human review:{" "}
            {report.humanReviewApproved
              ? "approved"
              : "pending or changes requested"}
            .
          </p>
          <ul>
            {report.claims.map((claim) => (
              <li key={claim.key}>
                <strong>
                  {claim.kind} · {claim.outcome}
                </strong>
                <p>{claim.statement}</p>
                <p>{claim.limitations.join(" ")}</p>
              </li>
            ))}
          </ul>
          <details>
            <summary>Evidence identity and limitations</summary>
            <p className="discovery-url">
              Build {report.buildId} · seal {report.sealSha256}
            </p>
            <p className="discovery-url">
              Evaluation {report.evaluationSha256}
            </p>
            <ul>
              {report.limitations.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </div>
  );
}
