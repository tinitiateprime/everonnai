import { copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EverOnnWorkspace } from "@/features/everonn/types";
import { createDemoWorkspace } from "@/features/everonn/demo-data";

const defaultDataFile = path.join(process.cwd(), "data", "everonn.json");
const dataFile = path.resolve(/*turbopackIgnore: true*/ process.env.EVERONN_DATA_FILE || defaultDataFile);
let writeQueue: Promise<unknown> = Promise.resolve();

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

export async function readWorkspaceJson() {
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
  const operation = writeQueue.then(() => writeAtomically(snapshot));
  writeQueue = operation.catch(() => undefined);
  return operation.then(() => structuredClone(snapshot));
}
