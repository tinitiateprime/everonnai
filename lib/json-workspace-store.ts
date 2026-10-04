import { getStore, type Store } from "@netlify/blobs";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EverOnnWorkspace } from "@/features/everonn/types";
import { createDemoWorkspace } from "@/features/everonn/demo-data";
import { appDatabaseConfigured, appRecords } from "./app-records";

type WorkspaceCollection = { version: 1; workspaces: EverOnnWorkspace[] };

const defaultDataFile = path.join(process.cwd(), "data", "everonn.json");
const dataFile = path.resolve(/*turbopackIgnore: true*/ process.env.EVERONN_DATA_FILE || defaultDataFile);
const workspacesFile = path.resolve(/*turbopackIgnore: true*/ process.env.EVERONN_WORKSPACES_FILE || path.join(path.dirname(dataFile), "workspaces.json"));
const primaryWorkspaceBlobKey = "workspace-v1";
const workspaceCollectionBlobKey = "workspaces-v1";
const emptyCollection = (): WorkspaceCollection => ({ version: 1, workspaces: [] });
let writeQueue: Promise<unknown> = Promise.resolve();

function usesNetlifyBlobs() {
  return process.env.NETLIFY === "true" || Boolean(process.env.NETLIFY_BLOBS_CONTEXT);
}

function workspaceBlobStore(): Store {
  return getStore({ name: "everonn-workspace", consistency: "strong" });
}

export function workspacePersistence() {
  if (appDatabaseConfigured()) return "supabase-postgres";
  return usesNetlifyBlobs() ? "netlify-json-blob" : "json-file";
}

const workspaceRecordKey = (workspaceId: string) => `workspaces/${createHash("sha256").update(workspaceId).digest("hex")}`;

async function readPrimaryWorkspaceDatabase() {
  const store = appRecords();
  let current = await store.read<EverOnnWorkspace>("workspaces/primary");
  if (!current) {
    const seed = await readSeedWorkspace();
    await store.write("workspaces/primary", seed, { new: true });
    current = await store.read<EverOnnWorkspace>("workspaces/primary");
  }
  if (!current) throw new Error("EverOnn could not initialize its database workspace.");
  validateWorkspace(current.data);
  return structuredClone(current.data);
}

async function updateWorkspaceDatabase(
  key: string,
  workspaceId: string,
  update: (current: EverOnnWorkspace) => EverOnnWorkspace | Promise<EverOnnWorkspace>,
) {
  const store = appRecords();
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = await store.read<EverOnnWorkspace>(key);
    if (!current) throw workspaceNotFound(workspaceId);
    validateWorkspace(current.data);
    if (current.data.workspaceId !== workspaceId) throw new Error("Database workspace scope mismatch.");
    const next = structuredClone(await update(structuredClone(current.data)));
    validateWorkspace(next);
    if (next.workspaceId !== workspaceId) throw new Error("A workspace update cannot change its ID.");
    if (await store.write(key, next, { revision: current.revision })) return structuredClone(next);
    await new Promise((resolve) => setTimeout(resolve, 15 * (attempt + 1)));
  }
  throw Object.assign(new Error("The workspace changed repeatedly while saving. Please retry."), { status: 409 });
}

function validateWorkspace(value: unknown): asserts value is EverOnnWorkspace {
  const workspace = value as Partial<EverOnnWorkspace> | null;
  if (!workspace || workspace.version !== 1 || typeof workspace.workspaceId !== "string") {
    throw new Error("The EverOnn JSON file has an invalid workspace envelope.");
  }
  if (!workspace.profile || workspace.profile.workspaceId !== workspace.workspaceId) {
    throw new Error("The EverOnn business profile is outside its workspace scope.");
  }
  const collections = [workspace.contacts, workspace.leads, workspace.conversations, workspace.appointments];
  if (collections.some((collection) => !Array.isArray(collection))) {
    throw new Error("The EverOnn JSON file is missing a required collection.");
  }
  for (const collection of collections as Array<Array<{ workspaceId: string }>>) {
    if (collection.some((row) => row.workspaceId !== workspace.workspaceId)) {
      throw new Error("The EverOnn JSON file contains cross-workspace records.");
    }
  }
  if (!Array.isArray(workspace.team) || !workspace.integrations) {
    throw new Error("The EverOnn JSON file is missing workspace settings.");
  }
  if (workspace.websiteProject && workspace.websiteProject.workspaceId !== workspace.workspaceId) {
    throw new Error("The website project is outside its workspace scope.");
  }
}

function validateCollection(value: unknown): asserts value is WorkspaceCollection {
  const collection = value as Partial<WorkspaceCollection> | null;
  if (!collection || collection.version !== 1 || !Array.isArray(collection.workspaces)) {
    throw new Error("The EverOnn workspace collection is invalid.");
  }
  const ids = new Set<string>();
  for (const workspace of collection.workspaces) {
    validateWorkspace(workspace);
    if (ids.has(workspace.workspaceId)) throw new Error("The EverOnn workspace collection contains a duplicate ID.");
    ids.add(workspace.workspaceId);
  }
}

async function readJsonFile(file: string) {
  try {
    return JSON.parse(await readFile(/*turbopackIgnore: true*/ file, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (error instanceof SyntaxError) throw new Error(`EverOnn could not parse ${file}. The file was left unchanged.`);
    throw error;
  }
}

async function ensurePrimaryDataFile() {
  await mkdir(path.dirname(dataFile), { recursive: true });
  try {
    await readFile(/*turbopackIgnore: true*/ dataFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await writeFile(dataFile, `${JSON.stringify(createDemoWorkspace(), null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  }
}

async function readPrimaryWorkspaceFile() {
  await ensurePrimaryDataFile();
  const workspace = await readJsonFile(dataFile);
  validateWorkspace(workspace);
  return structuredClone(workspace);
}

async function readWorkspaceCollectionFile() {
  const value = await readJsonFile(workspacesFile);
  if (!value) return emptyCollection();
  validateCollection(value);
  return structuredClone(value);
}

async function readSeedWorkspace() {
  const workspace = await readJsonFile(defaultDataFile);
  if (!workspace) return createDemoWorkspace();
  validateWorkspace(workspace);
  return structuredClone(workspace);
}

async function readPrimaryWorkspaceBlob() {
  const store = workspaceBlobStore();
  const current = await store.getWithMetadata(primaryWorkspaceBlobKey, { type: "json", consistency: "strong" });
  if (current) {
    validateWorkspace(current.data);
    return { workspace: structuredClone(current.data), etag: current.etag };
  }
  const seed = await readSeedWorkspace();
  const created = await store.setJSON(primaryWorkspaceBlobKey, seed, { onlyIfNew: true });
  if (created.modified) return { workspace: structuredClone(seed), etag: created.etag };
  const winner = await store.getWithMetadata(primaryWorkspaceBlobKey, { type: "json", consistency: "strong" });
  if (!winner) throw new Error("EverOnn could not initialize its Netlify JSON workspace.");
  validateWorkspace(winner.data);
  return { workspace: structuredClone(winner.data), etag: winner.etag };
}

async function readWorkspaceCollectionBlob() {
  const current = await workspaceBlobStore().getWithMetadata(workspaceCollectionBlobKey, { type: "json", consistency: "strong" });
  if (!current) return { collection: emptyCollection(), etag: undefined as string | undefined };
  validateCollection(current.data);
  return { collection: structuredClone(current.data), etag: current.etag };
}

async function readPrimaryUnqueued() {
  if (appDatabaseConfigured()) return readPrimaryWorkspaceDatabase();
  return usesNetlifyBlobs() ? (await readPrimaryWorkspaceBlob()).workspace : readPrimaryWorkspaceFile();
}

async function readCollectionUnqueued() {
  if (appDatabaseConfigured()) {
    const collection: WorkspaceCollection = { version: 1, workspaces: await appRecords().listWorkspaces<EverOnnWorkspace>() };
    validateCollection(collection);
    return collection;
  }
  return usesNetlifyBlobs() ? (await readWorkspaceCollectionBlob()).collection : readWorkspaceCollectionFile();
}

async function readAllUnqueued() {
  const [primary, collection] = await Promise.all([readPrimaryUnqueued(), readCollectionUnqueued()]);
  if (collection.workspaces.some((workspace) => workspace.workspaceId === primary.workspaceId)) {
    throw new Error("The primary workspace is duplicated in the workspace collection.");
  }
  return [primary, ...collection.workspaces];
}

function workspaceNotFound(workspaceId: string) {
  return Object.assign(new Error(`Workspace ${workspaceId} was not found.`), { status: 404 });
}

export async function readWorkspaceJson(workspaceId?: string) {
  await writeQueue.catch(() => undefined);
  const primary = await readPrimaryUnqueued();
  if (!workspaceId || workspaceId === primary.workspaceId) return primary;
  if (appDatabaseConfigured()) {
    const current = await appRecords().read<EverOnnWorkspace>(workspaceRecordKey(workspaceId));
    if (!current) throw workspaceNotFound(workspaceId);
    validateWorkspace(current.data);
    if (current.data.workspaceId !== workspaceId) throw new Error("Database workspace scope mismatch.");
    return structuredClone(current.data);
  }
  const collection = await readCollectionUnqueued();
  const workspace = collection.workspaces.find((item) => item.workspaceId === workspaceId);
  if (!workspace) throw workspaceNotFound(workspaceId);
  return structuredClone(workspace);
}

export async function readAllWorkspacesJson() {
  await writeQueue.catch(() => undefined);
  return (await readAllUnqueued()).map((workspace) => structuredClone(workspace));
}

export async function findWorkspaceJson(predicate: (workspace: EverOnnWorkspace) => boolean) {
  const workspace = (await readAllWorkspacesJson()).find(predicate);
  return workspace ? structuredClone(workspace) : null;
}

async function writeFileAtomically(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporaryFile = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    await rename(temporaryFile, file);
  } catch {
    await copyFile(temporaryFile, file);
    await unlink(temporaryFile).catch(() => undefined);
  }
}

async function writePrimaryFile(workspace: EverOnnWorkspace) {
  validateWorkspace(workspace);
  await writeFileAtomically(dataFile, workspace);
}

async function writeCollectionFile(collection: WorkspaceCollection) {
  validateCollection(collection);
  await writeFileAtomically(workspacesFile, collection);
}

async function mutateBlobCollection<T>(update: (collection: WorkspaceCollection) => T | Promise<T>) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await readWorkspaceCollectionBlob();
    const value = await update(current.collection);
    validateCollection(current.collection);
    const result = current.etag
      ? await workspaceBlobStore().setJSON(workspaceCollectionBlobKey, current.collection, { onlyIfMatch: current.etag })
      : await workspaceBlobStore().setJSON(workspaceCollectionBlobKey, current.collection, { onlyIfNew: true });
    if (result.modified) return value;
  }
  throw new Error("The workspace collection changed repeatedly while saving. Please retry.");
}

export function createWorkspaceJson(workspace: EverOnnWorkspace) {
  const snapshot = structuredClone(workspace);
  validateWorkspace(snapshot);
  const operation = writeQueue.then(async () => {
    const primary = await readPrimaryUnqueued();
    if (primary.workspaceId === snapshot.workspaceId) throw new Error("A workspace with this ID already exists.");
    if (appDatabaseConfigured()) {
      if (!await appRecords().write(workspaceRecordKey(snapshot.workspaceId), snapshot, { new: true })) throw new Error("A workspace with this ID already exists.");
    } else if (usesNetlifyBlobs()) {
      await mutateBlobCollection((collection) => {
        if (collection.workspaces.some((item) => item.workspaceId === snapshot.workspaceId)) throw new Error("A workspace with this ID already exists.");
        collection.workspaces.push(snapshot);
      });
    } else {
      const collection = await readWorkspaceCollectionFile();
      if (collection.workspaces.some((item) => item.workspaceId === snapshot.workspaceId)) throw new Error("A workspace with this ID already exists.");
      collection.workspaces.push(snapshot);
      await writeCollectionFile(collection);
    }
    return structuredClone(snapshot);
  });
  writeQueue = operation.catch(() => undefined);
  return operation;
}

export function deleteWorkspaceJson(workspaceId: string) {
  const operation = writeQueue.then(async () => {
    const primary = await readPrimaryUnqueued();
    if (primary.workspaceId === workspaceId) throw new Error("The primary workspace cannot be deleted.");
    if (appDatabaseConfigured()) {
      const store = appRecords();
      const key = workspaceRecordKey(workspaceId);
      const current = await store.read<EverOnnWorkspace>(key);
      if (current && !await store.remove(key, current.revision)) throw Object.assign(new Error("The workspace changed while deleting. Please retry."), { status: 409 });
    } else if (usesNetlifyBlobs()) {
      await mutateBlobCollection((collection) => {
        collection.workspaces = collection.workspaces.filter((item) => item.workspaceId !== workspaceId);
      });
    } else {
      const collection = await readWorkspaceCollectionFile();
      collection.workspaces = collection.workspaces.filter((item) => item.workspaceId !== workspaceId);
      await writeCollectionFile(collection);
    }
  });
  writeQueue = operation.catch(() => undefined);
  return operation;
}

export function writeWorkspaceJson(workspace: EverOnnWorkspace) {
  const snapshot = structuredClone(workspace);
  validateWorkspace(snapshot);
  const operation = writeQueue.then(async () => {
    const primary = await readPrimaryUnqueued();
    if (appDatabaseConfigured()) {
      const key = primary.workspaceId === snapshot.workspaceId ? "workspaces/primary" : workspaceRecordKey(snapshot.workspaceId);
      return updateWorkspaceDatabase(key, snapshot.workspaceId, () => snapshot);
    }
    if (primary.workspaceId === snapshot.workspaceId) {
      if (usesNetlifyBlobs()) await workspaceBlobStore().setJSON(primaryWorkspaceBlobKey, snapshot);
      else await writePrimaryFile(snapshot);
      return structuredClone(snapshot);
    }
    if (usesNetlifyBlobs()) {
      await mutateBlobCollection((collection) => {
        const index = collection.workspaces.findIndex((item) => item.workspaceId === snapshot.workspaceId);
        if (index < 0) throw workspaceNotFound(snapshot.workspaceId);
        collection.workspaces[index] = snapshot;
      });
    } else {
      const collection = await readWorkspaceCollectionFile();
      const index = collection.workspaces.findIndex((item) => item.workspaceId === snapshot.workspaceId);
      if (index < 0) throw workspaceNotFound(snapshot.workspaceId);
      collection.workspaces[index] = snapshot;
      await writeCollectionFile(collection);
    }
    return structuredClone(snapshot);
  });
  writeQueue = operation.catch(() => undefined);
  return operation;
}

export function updateWorkspaceJson(
  update: (current: EverOnnWorkspace) => EverOnnWorkspace | Promise<EverOnnWorkspace>,
  workspaceId?: string,
) {
  const operation = writeQueue.then(async () => {
    const primary = await readPrimaryUnqueued();
    const targetId = workspaceId || primary.workspaceId;
    if (appDatabaseConfigured()) {
      return updateWorkspaceDatabase(targetId === primary.workspaceId ? "workspaces/primary" : workspaceRecordKey(targetId), targetId, update);
    }
    if (targetId === primary.workspaceId) {
      if (usesNetlifyBlobs()) {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const current = await readPrimaryWorkspaceBlob();
          const next = structuredClone(await update(structuredClone(current.workspace)));
          validateWorkspace(next);
          if (next.workspaceId !== targetId) throw new Error("A workspace update cannot change its ID.");
          const result = current.etag
            ? await workspaceBlobStore().setJSON(primaryWorkspaceBlobKey, next, { onlyIfMatch: current.etag })
            : await workspaceBlobStore().setJSON(primaryWorkspaceBlobKey, next, { onlyIfNew: true });
          if (result.modified) return structuredClone(next);
        }
        throw new Error("The workspace changed repeatedly while saving. Please retry.");
      }
      const next = structuredClone(await update(structuredClone(primary)));
      validateWorkspace(next);
      if (next.workspaceId !== targetId) throw new Error("A workspace update cannot change its ID.");
      await writePrimaryFile(next);
      return structuredClone(next);
    }
    if (usesNetlifyBlobs()) {
      return mutateBlobCollection(async (collection) => {
        const index = collection.workspaces.findIndex((item) => item.workspaceId === targetId);
        if (index < 0) throw workspaceNotFound(targetId);
        const next = structuredClone(await update(structuredClone(collection.workspaces[index])));
        validateWorkspace(next);
        if (next.workspaceId !== targetId) throw new Error("A workspace update cannot change its ID.");
        collection.workspaces[index] = next;
        return structuredClone(next);
      });
    }
    const collection = await readWorkspaceCollectionFile();
    const index = collection.workspaces.findIndex((item) => item.workspaceId === targetId);
    if (index < 0) throw workspaceNotFound(targetId);
    const next = structuredClone(await update(structuredClone(collection.workspaces[index])));
    validateWorkspace(next);
    if (next.workspaceId !== targetId) throw new Error("A workspace update cannot change its ID.");
    collection.workspaces[index] = next;
    await writeCollectionFile(collection);
    return structuredClone(next);
  });
  writeQueue = operation.catch(() => undefined);
  return operation;
}
