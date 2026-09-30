import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, passwordIssues, verifyPassword } from "@/features/auth/password";

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
