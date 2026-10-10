"use client";
import { useEffect, useState } from "react";

type Summary = {
  name: string;
  rationale: string;
  context: {
    industry: string;
    audience: string;
    mood: string[];
    vibe: string;
  } | null;
  theme: { palette: string[]; typography: string; motif: string } | null;
  briefApplied: boolean;
  correctionsApplied: number;
  mode: "live" | "fixture";
};

// How the website designer read the business and the theme it chose for one build.
export function BuildDesignNote({
  base,
  buildId,
}: {
  base: string;
  buildId: string;
}) {
  const [summary, setSummary] = useState<Summary | null>(null);
  useEffect(() => {
    let mounted = true;
    fetch(`${base}/builds/${buildId}/design`, { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (mounted && data?.design) setSummary(data.design);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [base, buildId]);
  if (!summary) return null;
  return (
    <details className="design-note">
      <summary>
        Design: {summary.name}
        {summary.context ? ` · ${summary.context.mood.join(", ")}` : ""}
      </summary>
      {summary.theme && (
        <div className="design-swatches" aria-label="Theme palette">
          {summary.theme.palette.map((color) => (
            <span key={color} style={{ background: color }} title={color} />
          ))}
        </div>
      )}
      {summary.context && (
        <p>
          <strong>Reads the business as:</strong> {summary.context.industry},
          for {summary.context.audience}. {summary.context.vibe}
        </p>
      )}
      {summary.theme && (
        <p>
          <strong>Type:</strong> {summary.theme.typography}.{" "}
          <strong>Motif:</strong> {summary.theme.motif}
        </p>
      )}
      <p>{summary.rationale}</p>
      <p className="design-note-meta">
        {summary.briefApplied
          ? "Built from your improvement brief"
          : "No improvement brief was available"}
        {summary.correctionsApplied
          ? ` and ${summary.correctionsApplied} of your corrections`
          : ""}
        {summary.mode === "fixture" ? " · test fixture design" : ""}.
      </p>
    </details>
  );
}
