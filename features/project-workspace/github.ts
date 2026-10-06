import "server-only";
import type { RepositoryFile, RepositorySnapshot } from "./types";

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const projectError = (message: string, status = 400) => Object.assign(new Error(message), { status });
export const isDocument = (name: string) => /\.(md|mdown|mmd|mermaid)$/i.test(name);
const isImage = (name: string) => /\.(png|jpg|jpeg|gif|webp|avif)$/i.test(name);
const isSha = (value: string) => /^[a-f0-9]{40,64}$/i.test(value);

export function repositoryLocation(input: string) {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw projectError("Enter a GitHub repository URL such as https://github.com/company/project."); }
  const parts = url.pathname.replace(/\/$/, "").split("/").slice(1);
  const name = parts[1]?.replace(/\.git$/i, "");
  if (url.protocol !== "https:" || !["github.com", "www.github.com"].includes(url.hostname) || url.port || url.username || url.password || url.search || url.hash
    || parts.length !== 2 || !/^[A-Za-z0-9-]{1,100}$/.test(parts[0]) || !name || !/^[A-Za-z0-9_.-]{1,100}$/.test(name) || [".", ".."].includes(name)) {
    throw projectError("Use the clean GitHub repository URL. Enter an optional branch and folder separately.");
  }
  return { owner: parts[0], name, url: `https://github.com/${parts[0]}/${name}` };
}

export function repositoryPath(input: string, allowEmpty = false) {
  if (allowEmpty && input === "") return "";
  if (!input || input.length > 600 || /[\\\x00-\x1f\x7f]/.test(input) || input.split("/").some((part) => !part || part === "." || part === "..")) throw projectError("Enter a valid repository-relative file or folder path.");
  return input;
}

export function cleanGitHubToken(input: string) {
  const token = input.trim();
  if (token && !/^[A-Za-z0-9_.-]{10,500}$/.test(token)) throw projectError("Enter a valid GitHub access token.");
  return token;
}

async function boundedJson(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw projectError("GitHub returned an empty response.", 502);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.length;
      if (size > 8 * 1024 * 1024) throw projectError("This repository exceeds the documentation import limit.", 413);
      chunks.push(result.value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw projectError("GitHub returned an invalid response.", 502); }
}

export class ProjectGitHubClient {
  constructor(private readonly transport: typeof fetch = fetch) {}
  private async request(endpoint: string, token: string) {
    let response: Response;
    try {
      response = await this.transport(`https://api.github.com${endpoint}`, {
        headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10", "User-Agent": "EverOnnAI-Project-Workspace", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        signal: AbortSignal.timeout(20_000), cache: "no-store", redirect: "error",
      });
    } catch { throw projectError("GitHub could not be reached in time. Try again.", 504); }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 401) throw projectError("The GitHub token is invalid or expired. Reconnect with a new token.", 422);
      if (response.status === 403 || response.status === 429) throw projectError("GitHub denied this request or its rate limit was reached. Check Contents read permission and try later.", 429);
      if (response.status === 404) throw projectError("The repository, branch or document is unavailable. Private repositories need a token with Contents read access.", 422);
      throw projectError("GitHub could not return this repository. Try again later.", 502);
    }
    return boundedJson(response);
  }

  async snapshot(url: string, requestedBranch: string, scopePath: string, token = ""): Promise<RepositorySnapshot> {
    const location = repositoryLocation(url);
    repositoryPath(scopePath, true);
    if (requestedBranch.length > 160 || /[\s\\\x00-\x1f\x7f?*\[\]~^:]/.test(requestedBranch) || requestedBranch.startsWith("/") || requestedBranch.includes("..")) throw projectError("Enter a valid branch name.");
    const prefix = `/repos/${encodeURIComponent(location.owner)}/${encodeURIComponent(location.name)}`;
    const info = await this.request(prefix, token);
    const branch = requestedBranch || info.default_branch;
    if (typeof branch !== "string" || !branch) throw projectError("This repository has no committed branch yet.", 422);
    const tree = await this.request(`${prefix}/git/trees/${encodeURIComponent(branch)}?recursive=1`, token);
    if (tree.truncated || !Array.isArray(tree.tree) || tree.tree.length > 100_000) throw projectError("This repository's tree is too large to import completely.", 413);
    if (!isSha(tree.sha)) throw projectError("GitHub returned an invalid repository tree.", 502);
    const files: RepositoryFile[] = [], assets: RepositoryFile[] = [];
    for (const entry of tree.tree) {
      if (entry.type !== "blob" || entry.mode === "120000" || typeof entry.path !== "string" || !isSha(entry.sha)) continue;
      if (entry.path.split("/").some((part: string) => [".git", "node_modules", ".next", "dist", "build", "coverage", ".artifacts"].includes(part))) continue;
      if (scopePath && !entry.path.startsWith(`${scopePath}/`)) continue;
      const documentation = isDocument(entry.path);
      if (!documentation && !isImage(entry.path)) continue;
      try { repositoryPath(entry.path); } catch { continue; }
      if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > MAX_FILE_BYTES) {
        if (documentation) throw projectError("A document exceeds the 2 MB preview limit. Choose a smaller documentation folder.", 413);
        continue;
      }
      const file = { path: entry.path, sha: entry.sha, size: entry.size };
      if (documentation) files.push(file);
      else if (assets.length < 500) assets.push(file);
      if (files.length > 300) throw projectError("Choose a documentation folder containing at most 300 Markdown or Mermaid files.", 413);
    }
    if (!files.length) throw projectError("No Markdown or Mermaid documents were found in this repository folder.", 422);
    files.sort((left, right) => left.path.localeCompare(right.path));
    return { ...location, branch, scopePath, treeSha: tree.sha, syncedAt: new Date().toISOString(), private: info.private === true, files, assets };
  }

  async blob(repository: Pick<RepositorySnapshot, "owner" | "name">, file: RepositoryFile, token = "") {
    if (!isSha(file.sha) || file.size > MAX_FILE_BYTES) throw projectError("The repository document cannot be previewed.", 413);
    const result = await this.request(`/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/git/blobs/${file.sha}`, token);
    if (result.encoding !== "base64" || typeof result.content !== "string" || result.content.length > MAX_FILE_BYTES * 1.5 || result.size > MAX_FILE_BYTES) throw projectError("GitHub returned an unsupported or oversized document.", 413);
    const content = Buffer.from(result.content, "base64");
    if (content.length > MAX_FILE_BYTES || content.length !== result.size || content.length !== file.size) throw projectError("GitHub returned an incomplete document.", 502);
    return content;
  }
}
