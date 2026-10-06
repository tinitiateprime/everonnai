"use client";

import { useEffect, useId, useState } from "react";

export function MermaidDiagram({ chart, dark }: { chart: string; dark: boolean }) {
  const generatedId = useId().replace(/[^a-z0-9_-]/gi, "");
  const [rendered, setRendered] = useState<{ chart: string; dark: boolean; svg: string; error: string } | null>(null);
  const current = rendered?.chart === chart && rendered.dark === dark ? rendered : null;
  useEffect(() => {
    let cancelled = false;
    void import("mermaid")
      .then(({ default: mermaid }) => {
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "neutral", fontFamily: "ui-sans-serif, system-ui, sans-serif" });
        return mermaid.render(`mermaid-${generatedId}`, chart);
      })
      .then((result) => { if (!cancelled) setRendered({ chart, dark, svg: result.svg, error: "" }); })
      .catch((failure) => { if (!cancelled) setRendered({ chart, dark, svg: "", error: failure instanceof Error ? failure.message : "This Mermaid diagram could not be rendered." }); });
    return () => { cancelled = true; };
  }, [chart, dark, generatedId]);
  if (current?.error) return <div className="mermaid-error" role="alert"><p>This diagram could not be rendered.</p><details><summary>View source and error</summary><pre>{chart}</pre><pre>{current.error}</pre></details></div>;
  if (!current?.svg) return <div className="diagram-loading" role="status">Rendering diagram...</div>;
  return <div className="mermaid-diagram" dangerouslySetInnerHTML={{ __html: current.svg }} />;
}
