import { getStore, type Store } from "@netlify/blobs";
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EverOnnWorkspace } from "@/features/everonn/types";
import { createDemoWorkspace } from "@/features/everonn/demo-data";

const defaultDataFile = path.join(process.cwd(), "data", "everonn.json");
const dataFile = path.resolve(/*turbopackIgnore: true*/ process.env.EVERONN_DATA_FILE || defaultDataFile);
const workspaceBlobKey = "workspace-v1";
let writeQueue: Promise<unknown> = Promise.resolve();

function usesNetlifyBlobs() {
  return process.env.NETLIFY === "true" || Boolean(process.env.NETLIFY_BLOBS_CONTEXT);
}

function workspaceBlobStore(): Store {
  return getStore({ name: "everonn-workspace", consistency: "strong" });
}

export function workspacePersistence() {
  return usesNetlifyBlobs() ? "netlify-json-blob" : "json-file";
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

async function ensureDataFile() {
  await mkdir(path.dirname(dataFile), { recursive: true });
  try {
    await readFile(/*turbopackIgnore: true*/ dataFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await writeFile(dataFile, `${JSON.stringify(createDemoWorkspace(), null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  }
}

async function readWorkspaceFile() {
  await ensureDataFile();
  const source = await readFile(/*turbopackIgnore: true*/ dataFile, "utf8");
  let workspace: unknown;
  try {
    workspace = JSON.parse(source);
  } catch {
    throw new Error(`EverOnn could not parse ${dataFile}. The file was left unchanged.`);
  }
  validateWorkspace(workspace);
  return structuredClone(workspace);
}

async function readSeedWorkspace() {
  try {
    const source = await readFile(/*turbopackIgnore: true*/ defaultDataFile, "utf8");
    const workspace = JSON.parse(source) as unknown;
    validateWorkspace(workspace);
    return structuredClone(workspace);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return createDemoWorkspace();
  }
}

async function readWorkspaceBlob() {
  const store = workspaceBlobStore();
  const current = await store.getWithMetadata(workspaceBlobKey, { type: "json", consistency: "strong" });
  if (current) {
    validateWorkspace(current.data);
    return { workspace: structuredClone(current.data), etag: current.etag };
  }

  const seed = await readSeedWorkspace();
  const created = await store.setJSON(workspaceBlobKey, seed, { onlyIfNew: true });
  if (created.modified) return { workspace: structuredClone(seed), etag: created.etag };

  const winner = await store.getWithMetadata(workspaceBlobKey, { type: "json", consistency: "strong" });
  if (!winner) throw new Error("EverOnn could not initialize its Netlify JSON workspace.");
  validateWorkspace(winner.data);
  return { workspace: structuredClone(winner.data), etag: winner.etag };
}

export async function readWorkspaceJson() {
  await writeQueue;
  if (usesNetlifyBlobs()) return (await readWorkspaceBlob()).workspace;
  return readWorkspaceFile();
}

async function writeAtomically(workspace: EverOnnWorkspace) {
  validateWorkspace(workspace);
  await mkdir(path.dirname(dataFile), { recursive: true });
  const temporaryFile = `${dataFile}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify(workspace, null, 2)}\n`, "utf8");
  try {
    await rename(temporaryFile, dataFile);
  } catch {
    await copyFile(temporaryFile, dataFile);
    await unlink(temporaryFile).catch(() => undefined);
  }
}

export function writeWorkspaceJson(workspace: EverOnnWorkspace) {
  const snapshot = structuredClone(workspace);
  validateWorkspace(snapshot);
  const operation = writeQueue.then(async () => {
    if (usesNetlifyBlobs()) await workspaceBlobStore().setJSON(workspaceBlobKey, snapshot);
    else await writeAtomically(snapshot);
  });
  writeQueue = operation.catch(() => undefined);
  return operation.then(() => structuredClone(snapshot));
}

export function updateWorkspaceJson(
  update: (current: EverOnnWorkspace) => EverOnnWorkspace | Promise<EverOnnWorkspace>,
) {
  const operation = writeQueue.then(async () => {
    if (usesNetlifyBlobs()) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const current = await readWorkspaceBlob();
        const next = structuredClone(await update(structuredClone(current.workspace)));
        validateWorkspace(next);
        if (!current.etag) {
          await workspaceBlobStore().setJSON(workspaceBlobKey, next);
          return structuredClone(next);
        }
        const result = await workspaceBlobStore().setJSON(workspaceBlobKey, next, { onlyIfMatch: current.etag });
        if (result.modified) return structuredClone(next);
      }
      throw new Error("The workspace changed repeatedly while saving. Please retry.");
    }
    const current = await readWorkspaceFile();
    const next = structuredClone(await update(structuredClone(current)));
    await writeAtomically(next);
    return structuredClone(next);
  });
  writeQueue = operation.catch(() => undefined);
  return operation;
}
