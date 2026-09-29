import test from "node:test";
import assert from "node:assert/strict";
import { authorizeWorkspaceAction, hasCapability } from "@/features/auth/rbac";
import { TenantMemoryRepository } from "@/features/everonn/tenant-repository";

test("workspace roles expose only their intended capabilities", () => {
  assert.equal(hasCapability("owner", "billing:manage"), true);
  assert.equal(hasCapability("manager", "website:publish"), true);
  assert.equal(hasCapability("agent", "website:publish"), false);
  assert.equal(hasCapability("viewer", "inbox:operate"), false);
});

test("cross-workspace reads and writes are rejected", () => {
  const repository = new TenantMemoryRepository<{ id: string; workspaceId: string; value: string }>();
  repository.insert("workspace_a", { id: "row_a", workspaceId: "workspace_a", value: "private-a" });
  repository.insert("workspace_b", { id: "row_b", workspaceId: "workspace_b", value: "private-b" });
  assert.deepEqual(repository.list("workspace_a").map((row) => row.id), ["row_a"]);
  assert.throws(() => repository.get("workspace_a", "row_b"), /Cross-workspace access denied/);
  assert.throws(() => repository.insert("workspace_a", { id: "bad", workspaceId: "workspace_b", value: "no" }), /Cross-workspace access denied/);
});

test("authorization combines workspace scope and role grants", () => {
  assert.equal(authorizeWorkspaceAction({ workspaceId: "workspace_a", role: "manager" }, { workspaceId: "workspace_a" }, "business:configure"), true);
  assert.throws(() => authorizeWorkspaceAction({ workspaceId: "workspace_a", role: "agent" }, { workspaceId: "workspace_a" }, "knowledge:approve"), /cannot perform/);
  assert.throws(() => authorizeWorkspaceAction({ workspaceId: "workspace_a", role: "owner" }, { workspaceId: "workspace_b" }, "team:manage"), /Cross-workspace/);
});
