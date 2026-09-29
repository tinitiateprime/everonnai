import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type { EverOnnWorkspace } from "../features/everonn/types";

test("tracked JSON workspace is complete and tenant-scoped", async () => {
  const source = await readFile(path.join(process.cwd(), "data", "everonn.json"), "utf8");
  const workspace = JSON.parse(source) as EverOnnWorkspace;

  assert.equal(workspace.version, 1);
  assert.equal(workspace.profile.workspaceId, workspace.workspaceId);
  assert.ok(workspace.profile.businessName);
  assert.ok(Array.isArray(workspace.team));

  for (const collection of [workspace.contacts, workspace.leads, workspace.conversations, workspace.appointments]) {
    assert.ok(collection.every((record) => record.workspaceId === workspace.workspaceId));
  }

  if (workspace.websiteProject) {
    assert.equal(workspace.websiteProject.workspaceId, workspace.workspaceId);
  }
});
