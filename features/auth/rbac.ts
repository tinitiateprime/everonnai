import type { WorkspaceRole } from "@/features/everonn/types";

export type Capability =
  | "workspace:view"
  | "business:configure"
  | "knowledge:approve"
  | "inbox:operate"
  | "calls:operate"
  | "appointments:operate"
  | "website:publish"
  | "team:manage"
  | "billing:manage";

const grants: Record<WorkspaceRole, ReadonlySet<Capability>> = {
  owner: new Set(["workspace:view", "business:configure", "knowledge:approve", "inbox:operate", "calls:operate", "appointments:operate", "website:publish", "team:manage", "billing:manage"]),
  manager: new Set(["workspace:view", "business:configure", "knowledge:approve", "inbox:operate", "calls:operate", "appointments:operate", "website:publish"]),
  agent: new Set(["workspace:view", "inbox:operate", "calls:operate", "appointments:operate"]),
  viewer: new Set(["workspace:view"]),
};

export function hasCapability(role: WorkspaceRole, capability: Capability) {
  return grants[role].has(capability);
}

export function assertWorkspaceScope(actorWorkspaceId: string, resourceWorkspaceId: string) {
  if (!actorWorkspaceId || actorWorkspaceId !== resourceWorkspaceId) {
    throw Object.assign(new Error("Cross-workspace access denied."), { code: "WORKSPACE_SCOPE_VIOLATION", status: 403 });
  }
}

export function authorizeWorkspaceAction(actor: { workspaceId: string; role: WorkspaceRole }, resource: { workspaceId: string }, capability: Capability) {
  assertWorkspaceScope(actor.workspaceId, resource.workspaceId);
  if (!hasCapability(actor.role, capability)) {
    throw Object.assign(new Error(`The ${actor.role} role cannot perform ${capability}.`), { code: "INSUFFICIENT_ROLE", status: 403 });
  }
  return true;
}
