import type { EverOnnWorkspace } from "@/features/everonn/types";
import { listRecords, readRecord, updateRecord } from "./record-store";

export async function readWorkspaceJson(workspaceId: string) {
  const workspace = await readRecord<EverOnnWorkspace>("sites/" + workspaceId);
  if (!workspace || workspace.workspaceId !== workspaceId) throw Object.assign(new Error("Website not found."), { status: 404 });
  return workspace;
}
export async function updateWorkspaceJson(change: (workspace: EverOnnWorkspace) => EverOnnWorkspace, workspaceId: string) {
  return updateRecord<EverOnnWorkspace>("sites/" + workspaceId, (current) => {
    if (!current || current.workspaceId !== workspaceId) throw Object.assign(new Error("Website not found."), { status: 404 });
    const next = change(structuredClone(current));
    if (next.workspaceId !== workspaceId || next.profile.workspaceId !== workspaceId) throw new Error("Website scope mismatch.");
    return next;
  });
}
export async function findWorkspaceJson(predicate: (workspace: EverOnnWorkspace) => boolean) {
  return (await listRecords<EverOnnWorkspace>("sites")).find(predicate) || null;
}
