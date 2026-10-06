import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getStore } from "@netlify/blobs";
import { appDatabaseConfigured, appDatabaseQuery, type AppQuery } from "./app-records";
import type { RepositoryRecord } from "@/features/project-workspace/types";
import { projectError } from "@/features/project-workspace/github";

const locationKey = (row: RepositoryRecord) => JSON.stringify([row.owner.toLowerCase(), row.name.toLowerCase(), row.branch, row.scopePath]);
export function createProjectRepositoryDatabase(query: AppQuery) {
  return {
    async list(workspaceId: string): Promise<RepositoryRecord[]> {
      const rows = await query<{ payload: RepositoryRecord; revision: string }>("SELECT payload,revision FROM everonn.project_repositories WHERE workspace_id=$1 ORDER BY created_at,repository_id", [workspaceId]);
      return rows.map((row) => ({ ...row.payload, revision: row.revision }));
    },
    async save(row: RepositoryRecord, expectedRevision: string | null) {
      const { revision, ...payload } = row;
      void revision;
      const [result] = await query<{ accepted: boolean }>("SELECT everonn.write_project_repository($1,$2::uuid,$3::text::jsonb,$4::uuid) AS accepted", [row.workspaceId, row.id, JSON.stringify({ ...payload, locationKey: locationKey(row) }), expectedRevision]);
      if (!result?.accepted) throw projectError("This repository changed, is already connected, or the workspace has reached its 12-repository limit. Refresh and retry.", 409);
    },
    async remove(workspaceId: string, id: string, expectedRevision: string) {
      const result = await query("DELETE FROM everonn.project_repositories WHERE workspace_id=$1 AND repository_id=$2::uuid AND revision=$3::uuid RETURNING repository_id", [workspaceId, id, expectedRevision]);
      if (!result.length) throw projectError("This repository changed. Refresh before disconnecting it.", 409);
    },
  };
}

type FileStore = { version: 1; repositories: RepositoryRecord[] };
const empty = (): FileStore => ({ version: 1, repositories: [] });
const localFile = () => path.resolve(/*turbopackIgnore: true*/ process.env.EVERONN_PROJECTS_FILE || path.join(process.cwd(), "data", "project-repositories.json"));
const blobKey = (workspaceId: string) => `workspace-${createHash("sha256").update(workspaceId).digest("hex")}`;
const blobs = () => getStore({ name: "everonn-project-repositories", consistency: "strong" });
const usesBlobs = () => process.env.NETLIFY === "true" || Boolean(process.env.NETLIFY_BLOBS_CONTEXT);
let writes: Promise<unknown> = Promise.resolve();
function validate(value: unknown): asserts value is FileStore {
  const store = value as FileStore;
  if (!store || store.version !== 1 || !Array.isArray(store.repositories) || store.repositories.some((row) => !row.workspaceId || !row.id || !row.revision || !Array.isArray(row.files))) throw projectError("The project repository store is invalid.", 503);
}
async function readLocal() {
  try { const value = JSON.parse(await readFile(/*turbopackIgnore: true*/ localFile(), "utf8")); validate(value); return value; }
  catch (failure) { if ((failure as NodeJS.ErrnoException).code === "ENOENT") return empty(); throw failure; }
}
async function mutate(workspaceId: string, update: (rows: RepositoryRecord[]) => void) {
  const operation = writes.then(async () => {
    if (usesBlobs()) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const current = await blobs().getWithMetadata(blobKey(workspaceId), { type: "json", consistency: "strong" });
        const store = current ? structuredClone(current.data) : empty(); validate(store);
        if (store.repositories.some((row) => row.workspaceId !== workspaceId)) throw projectError("Project repository scope mismatch.", 503);
        update(store.repositories);
        const result = await blobs().setJSON(blobKey(workspaceId), store, current?.etag ? { onlyIfMatch: current.etag } : { onlyIfNew: true });
        if (result.modified) return;
      }
      throw projectError("Project repositories changed repeatedly. Retry.", 409);
    }
    const store = await readLocal();
    const rows = store.repositories.filter((row) => row.workspaceId === workspaceId);
    update(rows);
    store.repositories = [...store.repositories.filter((row) => row.workspaceId !== workspaceId), ...rows];
    const file = localFile();
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(/*turbopackIgnore: true*/ temporary, JSON.stringify(store), { encoding: "utf8", mode: 0o600 });
    await rename(/*turbopackIgnore: true*/ temporary, file);
  });
  writes = operation.catch(() => undefined);
  return operation;
}

export const projectRepositoryStore = {
  async list(workspaceId: string) {
    if (appDatabaseConfigured()) return createProjectRepositoryDatabase(appDatabaseQuery()).list(workspaceId);
    await writes;
    if (usesBlobs()) {
      const current = await blobs().get(blobKey(workspaceId), { type: "json", consistency: "strong" });
      const store = current || empty(); validate(store);
      if (store.repositories.some((row) => row.workspaceId !== workspaceId)) throw projectError("Project repository scope mismatch.", 503);
      return store.repositories;
    }
    return (await readLocal()).repositories.filter((row) => row.workspaceId === workspaceId);
  },
  async save(row: RepositoryRecord, expectedRevision: string | null) {
    if (appDatabaseConfigured()) return createProjectRepositoryDatabase(appDatabaseQuery()).save(row, expectedRevision);
    return mutate(row.workspaceId, (rows) => {
      const index = rows.findIndex((item) => item.id === row.id);
      if ((expectedRevision === null ? index !== -1 || rows.length >= 12 : index === -1 || rows[index].revision !== expectedRevision)
        || rows.some((item) => item.id !== row.id && locationKey(item) === locationKey(row))) throw projectError("This repository changed, is already connected, or the workspace has reached its 12-repository limit.", 409);
      const saved = { ...row, revision: randomUUID() };
      if (index === -1) rows.push(saved); else rows[index] = saved;
    });
  },
  async remove(workspaceId: string, id: string, expectedRevision: string) {
    if (appDatabaseConfigured()) return createProjectRepositoryDatabase(appDatabaseQuery()).remove(workspaceId, id, expectedRevision);
    return mutate(workspaceId, (rows) => {
      const index = rows.findIndex((item) => item.id === id && item.revision === expectedRevision);
      if (index === -1) throw projectError("This repository changed. Refresh before disconnecting it.", 409);
      rows.splice(index, 1);
    });
  },
};
