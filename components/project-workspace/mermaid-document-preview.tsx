"use client";

import { useState } from "react";
import { Code2, Workflow } from "lucide-react";
import { CopyButton } from "./markdown-preview";
import { MermaidDiagram } from "./mermaid-diagram";

export function MermaidDocumentPreview({ chart, dark }: { chart: string; dark: boolean }) {
  const [view, setView] = useState<"diagram" | "source">("diagram");

  return (
    <section className="mermaid-document" aria-label="Mermaid document preview">
      <header className="mermaid-document-toolbar">
        <div>
          <strong>{view === "diagram" ? "Rendered diagram" : "Mermaid source"}</strong>
          <span>{view === "diagram" ? "Interactive documentation preview" : "Version-controlled diagram definition"}</span>
        </div>
        <div className="diagram-view-switch" aria-label="Diagram view">
          <button
            type="button"
            className={view === "diagram" ? "active" : ""}
            onClick={() => setView("diagram")}
            aria-pressed={view === "diagram"}
          >
            <Workflow size={14} /> Diagram
          </button>
          <button
            type="button"
            className={view === "source" ? "active" : ""}
            onClick={() => setView("source")}
            aria-pressed={view === "source"}
          >
            <Code2 size={14} /> Source
          </button>
        </div>
      </header>

      {view === "diagram" ? (
        <div className="mermaid-document-canvas">
          <MermaidDiagram chart={chart} dark={dark} />
        </div>
      ) : (
        <div className="mermaid-source">
          <div className="code-toolbar">
            <span>Mermaid</span>
            <CopyButton value={chart} />
          </div>
          <pre><code>{chart}</code></pre>
        </div>
      )}
    </section>
  );
}
