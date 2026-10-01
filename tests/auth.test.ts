import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, passwordIssues, verifyPassword } from "@/features/auth/password";
import { createStarterWorkspace } from "@/features/everonn/starter-workspace";

test("password policy requires length and character variety", () => {
  assert.ok(passwordIssues("short").length >= 4);
  assert.deepEqual(passwordIssues("Strong-Password-2026!"), []);
});

test("passwords are scrypt hashed and verified without storing plaintext", async () => {
  const password = "Strong-Password-2026!";
  const encoded = await hashPassword(password);
  assert.match(encoded, /^scrypt\$/);
  assert.equal(encoded.includes(password), false);
  assert.equal(await verifyPassword(password, encoded), true);
  assert.equal(await verifyPassword("Wrong-Password-2026!", encoded), false);
});

test("self-registration starts an isolated owner workspace", () => {
  const workspace = createStarterWorkspace({
    workspaceId: "workspace_new",
    memberId: "member_new",
    ownerName: "New Owner",
    ownerEmail: "owner@example.com",
    businessName: "New Company",
    businessType: "Home services",
    timeZone: "Asia/Kolkata",
  });
  assert.equal(workspace.profile.workspaceId, "workspace_new");
  assert.equal(workspace.profile.businessName, "New Company");
  assert.equal(workspace.team[0]?.role, "owner");
  assert.equal(workspace.team[0]?.email, "owner@example.com");
  assert.deepEqual(workspace.contacts, []);
  assert.deepEqual(workspace.leads, []);
  assert.deepEqual(workspace.conversations, []);
  assert.deepEqual(workspace.appointments, []);
  assert.equal(workspace.websiteProject, null);
});
