"use client";

import { useMemo, useState } from "react";
import { ChevronRight, FileText, Folder, FolderOpen, Workflow } from "lucide-react";
import type { FileNode } from "@/features/project-workspace/types";

interface FileTreeProps {
  nodes: FileNode[];
  activePath: string | null;
  query: string;
  onSelect: (path: string) => void;
}

function filterNodes(nodes: FileNode[], query: string): FileNode[] {
  if (!query) return nodes;
  const normalizedQuery = query.toLowerCase();
  return nodes.flatMap((node) => {
    if (node.type === "file") {
      return node.name.toLowerCase().includes(normalizedQuery) ||
        node.path.toLowerCase().includes(normalizedQuery)
        ? [node]
        : [];
    }
    const children = filterNodes(node.children || [], query);
    return children.length ? [{ ...node, children }] : [];
  });
}

function TreeBranch({
  node,
  depth,
  activePath,
  forceOpen,
  onSelect,
}: {
  node: FileNode;
  depth: number;
  activePath: string | null;
  forceOpen: boolean;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth < 1);

  if (node.type === "directory") {
    const expanded = forceOpen || open;
    return (
      <li>
        <button
          className="tree-row directory-row"
          style={{ paddingLeft: 12 + depth * 14 }}
          onClick={() => setOpen((value) => !value)}
          aria-expanded={expanded}
        >
          <ChevronRight className={`tree-chevron ${expanded ? "expanded" : ""}`} size={14} />
          {expanded ? <FolderOpen size={16} /> : <Folder size={16} />}
          <span>{node.name}</span>
        </button>
        {expanded && (
          <ul>
            {(node.children || []).map((child) => (
              <TreeBranch
                key={child.path}
                node={child}
                depth={depth + 1}
                activePath={activePath}
                forceOpen={forceOpen}
                onSelect={onSelect}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <li>
      <button
        className={`tree-row file-row ${activePath === node.path ? "active" : ""}`}
        style={{ paddingLeft: 31 + depth * 14 }}
        onClick={() => onSelect(node.path)}
        title={node.path}
      >
        {node.kind === "mermaid" ? <Workflow className="mermaid-file-icon" size={15} /> : <FileText size={15} />}
        <span>
          {node.name.replace(/\.(?:md|mdown|mmd|mermaid)$/i, "")}
        </span>
        {node.kind === "mermaid" && <span className="kind-label">Diagram</span>}
      </button>
    </li>
  );
}

export function FileTree({ nodes, activePath, query, onSelect }: FileTreeProps) {
  const filteredNodes = useMemo(() => filterNodes(nodes, query.trim()), [nodes, query]);

  if (!filteredNodes.length) {
    return <div className="tree-empty">{query ? "No matching documents" : "No Markdown or Mermaid documents"}</div>;
  }

  return (
    <nav className="file-tree" aria-label="Project documents">
      <ul>
        {filteredNodes.map((node) => (
          <TreeBranch
            key={node.path}
            node={node}
            depth={0}
            activePath={activePath}
            forceOpen={Boolean(query.trim())}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </nav>
  );
}
