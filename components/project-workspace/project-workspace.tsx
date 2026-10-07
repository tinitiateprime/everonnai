"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ExternalLink, FolderGit2, Menu, Moon, Plus, RefreshCw, Search, Sun, Trash2, X } from "lucide-react";
import type { DocumentPayload, ProjectCatalog, RepositorySummary } from "@/features/project-workspace/types";
import { FileTree } from "./file-tree";
import { MarkdownPreview } from "./markdown-preview";
import { MermaidDocumentPreview } from "./mermaid-document-preview";
import { ConnectRepositoryDialog } from "./connect-repository-dialog";

const API = "/api/project-workspace";
const firstPath = (catalog: ProjectCatalog) => catalog.documents.find((item) => /^README\.(md|mdown)$/i.test(item.path))?.path || catalog.documents.find((item) => /(?:^|\/)README\.(md|mdown)$/i.test(item.path))?.path || catalog.documents[0]?.path;

export function ProjectWorkspace({ initialRepositories, canManage, businessName, initialError = "" }: { initialRepositories: RepositorySummary[]; canManage: boolean; businessName: string; initialError?: string }) {
  const router = useRouter();
  const [repositories, setRepositories] = useState(initialRepositories);
  const [catalog, setCatalog] = useState<ProjectCatalog | null>(null);
  const [document, setDocument] = useState<DocumentPayload | null>(null);
  const [activeId, setActiveId] = useState("");
  const [selectedPath, setSelectedPath] = useState("");
  const [query, setQuery] = useState("");
  const [dark, setDark] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialError);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const currentCatalog = catalog?.repository.id === activeId ? catalog : null;
  const activeRepository = repositories.find((item) => item.id === activeId);

  const requestJson = useCallback(async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(url, { ...init, cache: "no-store" });
    if (response.status === 401) router.replace("/login?returnTo=/workspace");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The repository could not be loaded.");
    return result as T;
  }, [router]);

  const load = useCallback(async (id: string, target = "", sync = false, supplied?: ProjectCatalog) => {
    pending.current?.abort();
    const request = new AbortController(); pending.current = request;
    setActiveId(id); setSidebarOpen(false); setLoading(true); setError("");
    try {
      const next = supplied || (sync ? await requestJson<ProjectCatalog>(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sync", repositoryId: id }), signal: request.signal })
        : catalog?.repository.id === id ? catalog : await requestJson<ProjectCatalog>(`${API}?repositoryId=${encodeURIComponent(id)}`, { signal: request.signal }));
      const path = target && next.documents.some((item) => item.path === target) ? target : firstPath(next);
      if (!path) throw new Error("No documents are available in this repository.");
      const doc = await requestJson<DocumentPayload>(`${API}?repositoryId=${encodeURIComponent(id)}&path=${encodeURIComponent(path)}`, { signal: request.signal });
      if (!request.signal.aborted) {
        setCatalog(next); setDocument(doc); setSelectedPath(path);
        setRepositories((rows) => rows.some((row) => row.id === id) ? rows.map((row) => row.id === id ? next.repository : row) : [...rows, next.repository]);
      }
    } catch (failure) { if (!request.signal.aborted) setError(failure instanceof Error ? failure.message : "The repository could not be loaded."); }
    finally { if (!request.signal.aborted) setLoading(false); }
  }, [catalog, requestJson]);
  const openDocument = useCallback((path: string) => { void load(activeId, path); }, [activeId, load]);
  async function disconnect() {
    if (!activeRepository || !window.confirm(`Disconnect ${activeRepository.owner}/${activeRepository.name} from this workspace?`)) return;
    pending.current?.abort(); setLoading(true); setError("");
    try {
      await requestJson(API, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repositoryId: activeId, revision: activeRepository.revision }) });
      setRepositories((rows) => rows.filter((row) => row.id !== activeId)); setActiveId(""); setCatalog(null); setDocument(null); setSelectedPath("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The repository could not be disconnected."); }
    finally { setLoading(false); }
  }

  return <div className={`pw-root ${dark ? "pw-dark" : ""}`}>
    <a className="pw-skip-link" href="#main">Skip to document</a>
    <aside className={`pw-sidebar ${sidebarOpen ? "pw-sidebar-open" : ""}`} aria-label="Project navigation">
      <Link className="pw-brand" href="/dashboard"><span>&infin;</span><strong>EverOnn<span>.Ai</span></strong></Link>
      <div className="pw-sidebar-heading"><span>Project workspace</span><button className="pw-mobile-only" onClick={() => setSidebarOpen(false)} aria-label="Close project navigation"><X size={18} /></button></div>
      {canManage && <div className="pw-repository-controls"><button className="pw-connect-button" onClick={() => setConnecting(true)} disabled={loading || repositories.length >= 12}><Plus size={15} /> Connect repository</button></div>}
      <label className="pw-search"><Search size={16} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a file or path" aria-label="Search project documents" /></label>
      <div className="pw-document-count">{repositories.length} connected {repositories.length === 1 ? "repository" : "repositories"}</div>
      <div className="pw-tree-scroll" inert={loading}>
        <nav className="pw-repositories" aria-label="Connected repositories">
          <ul>{repositories.map((row) => <li key={row.id}>
            <button className={`pw-repository-button ${row.id === activeId ? "is-active" : ""}`} disabled={loading} aria-label={`Open repository ${row.owner}/${row.name}`} aria-pressed={row.id === activeId} title={`${row.owner}/${row.name}`} onClick={() => { setQuery(""); void load(row.id); }}>
              <FolderGit2 size={18} aria-hidden="true" />
              <span className="pw-repository-name"><strong>{row.name}</strong><span>{row.owner} · {row.branch}</span></span>
            </button>
          </li>)}</ul>
          {!repositories.length && <p className="pw-repositories-empty">No connected repositories yet.</p>}
        </nav>
        {currentCatalog && <div className="pw-repository-documents"><div className="pw-repository-document-count">{currentCatalog.documents.length} documents / {currentCatalog.repository.branch}</div><FileTree key={activeId} nodes={currentCatalog.nodes} activePath={selectedPath} query={query} onSelect={openDocument} /></div>}
      </div>
      <div className="pw-sidebar-footer"><strong>{businessName}</strong><span>GitHub documentation shared with your workspace team.</span></div>
    </aside>
    {sidebarOpen && <button className="pw-scrim" onClick={() => setSidebarOpen(false)} aria-label="Close project navigation" />}
    <div className="pw-main">
      <header className="pw-topbar"><div className="pw-topbar-start"><button className="pw-mobile-only" onClick={() => setSidebarOpen(true)} aria-label="Open project navigation"><Menu size={20} /></button><Link href="/dashboard"><ArrowLeft size={15} /> Dashboard</Link><span className="pw-owner-label">Team project documents</span></div><div className="pw-actions"><button onClick={() => void load(activeId, selectedPath, true)} disabled={loading || !activeId} aria-label="Sync repository"><RefreshCw size={16} className={loading ? "pw-spinning" : ""} /><span>Sync</span></button><button onClick={() => setDark((value) => !value)} aria-label={dark ? "Use light theme" : "Use dark theme"}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button></div></header>
      <main id="main" className="pw-document" aria-busy={loading} tabIndex={-1}>
        {activeRepository && <div className="pw-repository-details"><a href={activeRepository.url} target="_blank" rel="noreferrer"><FolderGit2 size={16} /> {activeRepository.owner}/{activeRepository.name} <ExternalLink size={12} /></a><span>{activeRepository.private ? "Private" : "Public"} &middot; {activeRepository.scopePath || "All documentation"}</span>{canManage && <button onClick={() => void disconnect()} disabled={loading} aria-label="Disconnect repository"><Trash2 size={15} /></button>}</div>}
        {loading ? <div className="pw-notice" role="status">Loading repository documents...</div> : error ? <div className="pw-notice pw-error" role="alert">{error}{activeId && <button onClick={() => void load(activeId, selectedPath)}>Retry</button>}</div> : document && currentCatalog ? <>
          <div className="pw-document-heading"><div><span>{document.group}</span><h1>{document.title}</h1><p>{document.path}</p></div><span className="pw-read-only">Read only</span></div>
          <div className="pw-document-meta"><span>{Math.max(1, Math.round(document.size / 1024))} KB</span>{document.tasks.total > 0 && <span>{document.tasks.complete} of {document.tasks.total} tasks complete</span>}<span>{document.kind === "mermaid" ? "Mermaid diagram" : "Markdown"}</span></div>
          {document.kind === "mermaid" ? <MermaidDocumentPreview chart={document.content} dark={dark} /> : <MarkdownPreview content={document.content} documentPath={document.path} repositoryId={activeId} dark={dark} onOpenDocument={openDocument} />}
        </> : <section className="pw-empty"><FolderGit2 size={36} /><h1>{repositories.length ? "Open a project repository" : "Your team's project documentation"}</h1><p>{repositories.length ? "Choose a connected repository to browse its guides, task lists and diagrams." : "Keep project guides, Markdown task lists and diagrams together, directly from GitHub."}</p>{canManage && !repositories.length ? <button onClick={() => setConnecting(true)}><Plus size={16} /> Connect your first repository</button> : !repositories.length && <p>Ask an owner or manager to connect a repository.</p>}</section>}
      </main>
    </div>
    {connecting && <ConnectRepositoryDialog onClose={() => setConnecting(false)} onConnect={async (input) => {
      const next = await requestJson<ProjectCatalog>(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "connect", ...input }) });
      setConnecting(false); setRepositories((rows) => [...rows, next.repository]); setQuery(""); void load(next.repository.id, "", false, next);
    }} />}
  </div>;
}
