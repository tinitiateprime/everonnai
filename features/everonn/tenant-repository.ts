import { assertWorkspaceScope } from "@/features/auth/rbac";

type TenantRow = { id: string; workspaceId: string };

export class TenantMemoryRepository<T extends TenantRow> {
  private rows = new Map<string, T>();

  insert(actorWorkspaceId: string, row: T) {
    assertWorkspaceScope(actorWorkspaceId, row.workspaceId);
    this.rows.set(row.id, structuredClone(row));
    return structuredClone(row);
  }

  list(actorWorkspaceId: string) {
    return [...this.rows.values()].filter((row) => row.workspaceId === actorWorkspaceId).map((row) => structuredClone(row));
  }

  get(actorWorkspaceId: string, id: string) {
    const row = this.rows.get(id);
    if (!row) return null;
    assertWorkspaceScope(actorWorkspaceId, row.workspaceId);
    return structuredClone(row);
  }

  update(actorWorkspaceId: string, id: string, patch: Partial<Omit<T, "id" | "workspaceId">>) {
    const row = this.get(actorWorkspaceId, id);
    if (!row) return null;
    const next = { ...row, ...patch, id: row.id, workspaceId: row.workspaceId } as T;
    this.rows.set(id, structuredClone(next));
    return structuredClone(next);
  }
}
