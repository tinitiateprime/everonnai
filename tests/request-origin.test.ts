import assert from "node:assert/strict";
import test from "node:test";
import { isSameOriginRequest } from "@/features/auth/request-origin";

const publicOrigin = "https://main.example.amplifyapp.com";
const internalUrl = "http://localhost:3000/api/auth/setup";

test("owner setup accepts the configured public origin behind an internal proxy URL", () => {
  const request = new Request(internalUrl, { headers: { origin: publicOrigin } });
  assert.equal(isSameOriginRequest(request, publicOrigin), true);
  assert.equal(isSameOriginRequest(request, `${publicOrigin}/`), true);
  assert.equal(isSameOriginRequest(request, ""), false);
});

test("origin protection accepts direct hosting and development without a configured public URL", () => {
  for (const origin of [publicOrigin, "http://localhost:3000"]) {
    const request = new Request(`${origin}/api/auth/login`, { headers: { origin } });
    assert.equal(isSameOriginRequest(request, ""), true);
  }
});

test("a configured public origin rejects unrelated origins and ignores spoofed proxy headers", () => {
  for (const origin of ["https://attacker.example", `${publicOrigin}.attacker.example`, "http://localhost:3000", "http://main.example.amplifyapp.com", `${publicOrigin}:8443`]) {
    const request = new Request(internalUrl, {
      headers: { origin, host: new URL(origin).host, "x-forwarded-host": new URL(origin).host, "x-forwarded-proto": "https" },
    });
    assert.equal(isSameOriginRequest(request, publicOrigin), false);
  }
});

test("origin protection rejects malformed origins and invalid public URL configuration", () => {
  for (const origin of ["null", "", `${publicOrigin}/path`, `${publicOrigin}, https://attacker.example`, "https://user:password@main.example.amplifyapp.com"]) {
    assert.equal(isSameOriginRequest(new Request(internalUrl, { headers: { origin } }), publicOrigin), false);
  }
  const request = new Request(`${publicOrigin}/api/auth/setup`, { headers: { origin: publicOrigin } });
  for (const appUrl of ["invalid", "*", "file:///tmp", `${publicOrigin}/login`, `${publicOrigin}?query=value`, "https://user:password@main.example.amplifyapp.com"]) {
    assert.equal(isSameOriginRequest(request, appUrl), false);
  }
});

test("requests without a browser Origin header retain existing behavior", () => {
  assert.equal(isSameOriginRequest(new Request(internalUrl), publicOrigin), true);
});
