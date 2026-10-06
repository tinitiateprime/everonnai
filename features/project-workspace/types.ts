export type FileNode = { name: string; path: string; type: "directory" | "file"; children?: FileNode[]; kind?: "markdown" | "mermaid"; size?: number };
export type ProjectDocument = { path: string; name: string; title: string; group: string; kind: "markdown" | "mermaid"; modifiedAt: string; size: number; tasks: { complete: number; total: number } };
export type DocumentPayload = ProjectDocument & { content: string };
export type RepositoryFile = { path: string; sha: string; size: number };
export type RepositorySnapshot = { owner: string; name: string; branch: string; scopePath: string; treeSha: string; syncedAt: string; private: boolean; url: string; files: RepositoryFile[]; assets: RepositoryFile[] };
export type RepositoryRecord = RepositorySnapshot & { id: string; workspaceId: string; createdAt: string; revision: string; credential?: { version: 1; iv: string; tag: string; ciphertext: string } };
export type RepositorySummary = Pick<RepositoryRecord, "id" | "owner" | "name" | "branch" | "scopePath" | "syncedAt" | "private" | "url" | "revision"> & { documentCount: number; authenticated: boolean };
export type ProjectCatalog = { repository: RepositorySummary; documents: ProjectDocument[]; nodes: FileNode[]; checkedAt: string };
