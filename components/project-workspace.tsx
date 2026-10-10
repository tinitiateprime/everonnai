"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Actor } from "@/lib/auth/sessions";
import type { ArtifactRecord, Project, Tenant } from "@/lib/projects/service";
import { ProjectIntelligence } from "./project-intelligence";
import { ProjectDiscovery } from "./project-discovery";
import { ProjectEngineering } from "./project-engineering";

type Session = {
  actor: Actor | null;
  configuration: { database: string; login: string; storage: string };
};
type Detail = {
  project: Project;
  alternatives: { id: string; slot: number; name: string }[];
  artifacts: ArtifactRecord[];
  jobs: unknown[];
};
async function api<T>(route: string, init?: RequestInit): Promise<T> {
  const response = await fetch("/api/platform/" + route, {
    ...init,
    credentials: "same-origin",
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error || "Could not complete the workspace action.");
  return body;
}
const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export function ProjectWorkspace() {
  const [session, setSession] = useState<Session | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() {
    const current = await api<Session>("session");
    setSession(current);
    if (current.actor) {
      const [workspaces, list] = await Promise.all([
        api<{ tenants: Tenant[] }>("tenants"),
        api<{ projects: Project[] }>("projects"),
      ]);
      setTenants(workspaces.tenants);
      setProjects(list.projects);
      setTenantId((previous) =>
        workspaces.tenants.some((item) => item.id === previous)
          ? previous
          : workspaces.tenants[0]?.id || "",
      );
    } else {
      setTenants([]);
      setProjects([]);
      setDetail(null);
    }
  }
  useEffect(() => {
    let active = true;
    async function initialize() {
      try {
        const current = await api<Session>("session");
        if (!active) return;
        setSession(current);
        if (current.actor) {
          const [workspaces, list] = await Promise.all([
            api<{ tenants: Tenant[] }>("tenants"),
            api<{ projects: Project[] }>("projects"),
          ]);
          if (!active) return;
          setTenants(workspaces.tenants);
          setProjects(list.projects);
          setTenantId(workspaces.tenants[0]?.id || "");
        }
      } catch (issue) {
        if (active)
          setError(
            issue instanceof Error
              ? issue.message
              : "Could not load your workspace.",
          );
      }
    }
    void initialize();
    return () => {
      active = false;
    };
  }, []);
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (issue) {
      setError(
        issue instanceof Error
          ? issue.message
          : "Could not complete this action.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="workspace-page">
      <header className="workspace-header">
        <div>
          <p className="workspace-eyebrow">EverOnn AI</p>
          <h1>Your website projects</h1>
          <p>
            Keep each business, its source material and its three design
            alternatives in one workspace.
          </p>
        </div>
        <Link href="/">Open website studio</Link>
      </header>
      {error && (
        <p className="workspace-alert" role="alert">
          {error}
        </p>
      )}
      {!session && !error && <p role="status">Loading your workspace…</p>}
      {session && !session.actor && (
        <section className="workspace-card">
          <h2>Sign in to your workspace</h2>
          {session.configuration.login === "oidc" ? (
            <a className="workspace-button" href="/api/platform/auth/login">
              Sign in
            </a>
          ) : session.configuration.login === "local" ? (
            <>
              <p>
                This local development workspace uses a development account.
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await api("auth/development", post({}));
                    await refresh();
                  })
                }
              >
                Open local workspace
              </button>
            </>
          ) : (
            <p>
              Workspace sign-in has not been configured yet. The website studio
              is available through the link above.
            </p>
          )}
        </section>
      )}
      {session?.actor && (
        <>
          <div className="workspace-account">
            <p>Signed in as {session.actor.displayName}</p>
            <button
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await api("auth/logout", post({}));
                  await refresh();
                })
              }
            >
              Sign out
            </button>
          </div>
          <div className="workspace-grid">
            <section className="workspace-card">
              <h2>Workspaces</h2>
              {tenants.length > 0 && (
                <label>
                  Active workspace
                  <select
                    value={tenantId}
                    onChange={(event) => {
                      setTenantId(event.target.value);
                      setDetail(null);
                    }}
                  >
                    {tenants.map((tenant) => (
                      <option key={tenant.id} value={tenant.id}>
                        {tenant.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void action(async () => {
                    const result = await api<{ tenant: Tenant }>(
                      "tenants",
                      post({ name: workspaceName }),
                    );
                    setWorkspaceName("");
                    await refresh();
                    setTenantId(result.tenant.id);
                    setDetail(null);
                  });
                }}
              >
                <label>
                  New workspace name
                  <input
                    required
                    maxLength={120}
                    value={workspaceName}
                    onChange={(event) => setWorkspaceName(event.target.value)}
                  />
                </label>
                <button disabled={busy}>Create workspace</button>
              </form>
            </section>
            <section className="workspace-card">
              <h2>Create a website project</h2>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void action(async () => {
                    const result = await api<{ project: Project }>(
                      `tenants/${tenantId}/projects`,
                      post({ name: projectName, sourceUrl: websiteUrl }),
                    );
                    setProjectName("");
                    setWebsiteUrl("");
                    await refresh();
                    setDetail(
                      await api<Detail>(`projects/${result.project.id}`),
                    );
                  });
                }}
              >
                <label>
                  Business or project name
                  <input
                    required
                    maxLength={120}
                    value={projectName}
                    onChange={(event) => setProjectName(event.target.value)}
                  />
                </label>
                <label>
                  Existing website URL
                  <input
                    type="url"
                    maxLength={2048}
                    placeholder="https://your-business.com"
                    value={websiteUrl}
                    onChange={(event) => setWebsiteUrl(event.target.value)}
                  />
                </label>
                <button disabled={busy || !tenantId}>Create project</button>
              </form>
            </section>
          </div>
          <section className="workspace-card">
            <h2>Projects</h2>
            {projects.filter((project) => project.tenantId === tenantId)
              .length === 0 ? (
              <p>Create your first project to save its source material.</p>
            ) : (
              <ul className="workspace-project-list">
                {projects
                  .filter((project) => project.tenantId === tenantId)
                  .map((project) => (
                    <li key={project.id}>
                      <div>
                        <strong>{project.name}</strong>
                        <p>{project.sourceUrl || "Website URL not added"}</p>
                      </div>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void action(async () =>
                            setDetail(
                              await api<Detail>(`projects/${project.id}`),
                            ),
                          )
                        }
                      >
                        Open project
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </section>
          {detail && (
            <section className="workspace-card">
              <h2>{detail.project.name}</h2>
              <p>
                Discover source evidence, approve the business facts and page
                blueprint, then generate and verify three complete alternatives.
              </p>
              <ProjectDiscovery
                key={detail.project.id}
                projectId={detail.project.id}
                sourceUrl={detail.project.sourceUrl}
                canEdit={detail.project.canEdit}
              />
              <ProjectIntelligence
                key={detail.project.id + "-intelligence"}
                projectId={detail.project.id}
                sourceUrl={detail.project.sourceUrl}
                canEdit={detail.project.canEdit}
              />
              <ProjectEngineering
                key={detail.project.id}
                projectId={detail.project.id}
                alternatives={detail.alternatives}
                canEdit={detail.project.canEdit}
                canReview={detail.project.canReview}
              />
              <h3>Private source material</h3>
              {detail.project.canEdit && (
                <label>
                  Upload a document (up to 64 MB)
                  <input
                    type="file"
                    disabled={busy}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (!file) return;
                      if (file.size > 64000000) {
                        setError("Choose a file smaller than 64 MB.");
                        return;
                      }
                      void action(async () => {
                        await api(`projects/${detail.project.id}/artifacts`, {
                          method: "POST",
                          headers: {
                            "Content-Type":
                              file.type || "application/octet-stream",
                            "x-file-name": encodeURIComponent(file.name),
                          },
                          body: file,
                        });
                        setDetail(
                          await api<Detail>(`projects/${detail.project.id}`),
                        );
                      });
                    }}
                  />
                </label>
              )}
              {detail.artifacts.length === 0 ? (
                <p>No files uploaded yet.</p>
              ) : (
                <ul>
                  {detail.artifacts.map((artifact) => (
                    <li key={artifact.id}>
                      <a
                        href={`/api/platform/projects/${detail.project.id}/artifacts/${artifact.id}`}
                      >
                        {artifact.filename}
                      </a>{" "}
                      <span>({artifact.byteSize.toLocaleString()} bytes)</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}
