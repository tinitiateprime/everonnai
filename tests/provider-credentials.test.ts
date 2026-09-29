import assert from "node:assert/strict";
import test from "node:test";
import { decryptProviderPayload, encryptProviderPayload, signGoogleOAuthState, verifyGoogleOAuthState } from "../lib/provider-credentials";

const secret = "everonn-test-encryption-secret-that-is-long-enough";

test("provider credentials encrypt and authenticate at rest", () => {
  const encrypted = encryptProviderPayload({ accessToken: "private-token", refreshToken: "private-refresh" }, secret);
  assert.equal(JSON.stringify(encrypted).includes("private-token"), false);
  assert.deepEqual(decryptProviderPayload(encrypted, secret), { accessToken: "private-token", refreshToken: "private-refresh" });
  assert.throws(() => decryptProviderPayload({ ...encrypted, ciphertext: `${encrypted.ciphertext}a` }, secret));
});

test("Google OAuth state is signed, browser-bound, and expires", () => {
  const state = { workspaceId: "workspace_everonn_demo", nonce: "browser-nonce", returnTo: "/dashboard/settings", expiresAt: Date.now() + 60_000 };
  const signed = signGoogleOAuthState(state, secret);
  assert.deepEqual(verifyGoogleOAuthState(signed, secret), state);
  assert.throws(() => verifyGoogleOAuthState(`${signed}tampered`, secret));
  assert.throws(() => verifyGoogleOAuthState(signGoogleOAuthState({ ...state, expiresAt: Date.now() - 1 }, secret), secret));
});
