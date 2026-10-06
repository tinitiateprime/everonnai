import "server-only";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { projectRepositoryStore } from "@/lib/project-repository-store";
import { decryptProviderPayload, encryptProviderPayload } from "@/lib/provider-credentials";
import { ProjectGitHubClient, cleanGitHubToken, isDocument, projectError, repositoryPath } from "./github";
import type { DocumentPayload, FileNode, ProjectCatalog, ProjectDocument, RepositoryRecord, RepositorySummary } from "./types";

export function repositorySummary(row: RepositoryRecord): RepositorySummary {
  return { id: row.id, owner: row.owner, name: row.name, branch: row.branch, scopePath: row.scopePath, syncedAt: row.syncedAt, private: row.private, url: row.url, revision: row.revision, documentCount: row.files.length, authenticated: Boolean(row.credential) };
}
export function repositoryToken(row: RepositoryRecord, secret = process.env.CREDENTIAL_ENCRYPTION_KEY || "") {
  if (!row.credential) return "";
  let value: { workspaceId: string; repositoryId: string; token: string };
  try { value = decryptProviderPayload(row.credential, secret); }
  catch { throw projectError("The repository token could not be opened. Reconnect with a valid encryption configuration.", 503); }
  if (value.workspaceId !== row.workspaceId || value.repositoryId !== row.id) throw projectError("Repository credential scope mismatch.", 403);
  return value.token;
}
async function repositoryFor(workspaceId: string, id: string) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw projectError("Select a valid repository.");
  const row = (await projectRepositoryStore.list(workspaceId)).find((item) => item.id === id);
  if (!row) throw projectError("This repository is not connected to your workspace.", 404);
  return row;
}
export const listRepositories = async (workspaceId: string) => (await projectRepositoryStore.list(workspaceId)).map(repositorySummary);
export async function connectRepository(workspaceId: string, input: { url: string; branch?: string; folder?: string; token?: string }) {
  if ((await projectRepositoryStore.list(workspaceId)).length >= 12) throw projectError("A workspace can connect up to 12 repositories.", 409);
  const token = cleanGitHubToken(input.token || "");
  const secret = process.env.CREDENTIAL_ENCRYPTION_KEY || "";
  if (token && secret.trim().length < 32) throw projectError("Configure CREDENTIAL_ENCRYPTION_KEY before connecting authenticated GitHub repositories.", 503);
  const id = randomUUID();
  const snapshot = await new ProjectGitHubClient().snapshot(input.url, input.branch?.trim() || "", input.folder?.trim().replace(/\/$/, "") || "", token);
  const row: RepositoryRecord = { ...snapshot, id, workspaceId, createdAt: new Date().toISOString(), revision: "", ...(token ? { credential: encryptProviderPayload({ workspaceId, repositoryId: id, token }, secret) } : {}) };
  await projectRepositoryStore.save(row, null);
  return catalogFor(await repositoryFor(workspaceId, id));
}
export async function syncRepository(workspaceId: string, id: string) {
  const row = await repositoryFor(workspaceId, id);
  const snapshot = await new ProjectGitHubClient().snapshot(row.url, row.branch, row.scopePath, repositoryToken(row));
  await projectRepositoryStore.save({ ...row, ...snapshot }, row.revision);
  return catalogFor(await repositoryFor(workspaceId, id));
}
export async function disconnectRepository(workspaceId: string, id: string, revision: string) {
  const row = await repositoryFor(workspaceId, id);
  if (revision !== row.revision) throw projectError("This repository changed. Refresh before disconnecting it.", 409);
  await projectRepositoryStore.remove(workspaceId, id, revision);
}
export function describeDocument(name: string, content: string, syncedAt: string): DocumentPayload {
  const fileName = path.posix.basename(name);
  const textWithoutFences = content.replace(/(```|~~~)[\s\S]*?\1/g, "");
  const tasks = [...textWithoutFences.matchAll(/^\s*[-*+]\s+\[([ xX])\]\s+/gm)];
  return { path: name, name: fileName, title: content.match(/^\s*#\s+(.+)$/m)?.[1]?.trim() || fileName,
    group: path.posix.dirname(name) === "." ? "Repository" : path.posix.dirname(name), kind: /\.(mmd|mermaid)$/i.test(name) ? "mermaid" : "markdown",
    modifiedAt: syncedAt, size: Buffer.byteLength(content), content, tasks: { complete: tasks.filter((item) => item[1].toLowerCase() === "x").length, total: tasks.length } };
}
export function catalogFor(row: RepositoryRecord): ProjectCatalog {
  const documents: ProjectDocument[] = row.files.map((file) => {
    const { content, ...metadata } = describeDocument(file.path, "", row.syncedAt);
    void content;
    return { ...metadata, size: file.size };
  });
  const nodes: FileNode[] = [];
  for (const document of documents) {
    let children = nodes;
    const segments = document.path.split("/");
    let prefix = "";
    for (const segment of segments.slice(0, -1)) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      let directory = children.find((node) => node.path === prefix && node.type === "directory");
      if (!directory) { directory = { name: segment, path: prefix, type: "directory", children: [] }; children.push(directory); }
      children = directory.children!;
    }
    children.push({ name: document.name, path: document.path, type: "file", kind: document.kind, size: document.size });
  }
  const sort = (rows: FileNode[]) => { rows.sort((a, b) => Number(b.type === "directory") - Number(a.type === "directory") || a.name.localeCompare(b.name)); rows.forEach((node) => { if (node.children) sort(node.children); }); };
  sort(nodes);
  return { repository: repositorySummary(row), documents, nodes, checkedAt: row.syncedAt };
}
export async function readRepositoryCatalog(workspaceId: string, id: string) { return catalogFor(await repositoryFor(workspaceId, id)); }
export async function readRepositoryDocument(workspaceId: string, id: string, name: string) {
  const row = await repositoryFor(workspaceId, id);
  repositoryPath(name);
  const file = row.files.find((item) => item.path === name);
  if (!file || !isDocument(name)) throw projectError("This document is not in the repository's documentation catalog.", 404);
  const bytes = await new ProjectGitHubClient().blob(row, file, repositoryToken(row));
  let content: string;
  try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw projectError("This document is not UTF-8 text.", 422); }
  return describeDocument(name, content, row.syncedAt);
}
export async function readRepositoryImage(workspaceId: string, id: string, name: string) {
  const row = await repositoryFor(workspaceId, id);
  repositoryPath(name);
  const file = row.assets.find((item) => item.path === name);
  if (!file) throw projectError("This image is not in the repository asset catalog.", 404);
  const bytes = await new ProjectGitHubClient().blob(row, file, repositoryToken(row));
  const extension = path.posix.extname(name).toLowerCase();
  const checks: Record<string, [string, boolean]> = {
    ".png": ["image/png", bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))],
    ".jpg": ["image/jpeg", bytes.subarray(0, 3).equals(Buffer.from([255,216,255]))],
    ".jpeg": ["image/jpeg", bytes.subarray(0, 3).equals(Buffer.from([255,216,255]))],
    ".gif": ["image/gif", /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())],
    ".webp": ["image/webp", bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP"],
    ".avif": ["image/avif", bytes.subarray(4, 8).toString() === "ftyp" && /avif|avis/.test(bytes.subarray(8, 32).toString())],
  };
  const check = checks[extension];
  if (!check?.[1]) throw projectError("This repository asset is not a supported raster image.", 422);
  return { bytes, contentType: check[0] };
}
