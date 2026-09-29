import test from "node:test";
import assert from "node:assert/strict";
import { createDemoWorkspace } from "@/features/everonn/demo-data";
import { createWebsiteProject, generateDeterministicWebsiteSpec, runWebsiteQa } from "@/features/website-studio/generator";
import { buildReceptionistPrompt, detectUrgency } from "@/features/voice-agent/engine";
import { buildGmailRaw } from "@/features/integrations/google";

test("website generation preserves approved services and passes QA", () => {
  const profile = createDemoWorkspace().profile;
  const project = createWebsiteProject(profile, generateDeterministicWebsiteSpec(profile));
  assert.equal(project.concepts.length, 3);
  assert.equal(project.status, "generated");
  assert.equal(project.qa.passed, true);
  assert.deepEqual(project.spec.services.map((service) => service.name), profile.services.filter((service) => service.active).map((service) => service.name));
  assert.ok(project.spec.services.every((service) => service.slug && service.imageQuery && service.pageSections.length >= 2));
  assert.equal(project.spec.process.length, 3);
  assert.equal(project.spec.benefits.length, 3);
  assert.equal(runWebsiteQa(project.spec, profile).passed, true);
});

test("unsupported claims fail website QA", () => {
  const profile = createDemoWorkspace().profile;
  const project = createWebsiteProject(profile, generateDeterministicWebsiteSpec(profile));
  project.spec.about.body += " We are award-winning and guaranteed.";
  const qa = runWebsiteQa(project.spec, profile);
  assert.equal(qa.passed, false);
  assert.equal(qa.checks.find((check) => check.key === "no-unsupported-claims")?.passed, false);
});

test("phone front desk detects urgency and instructs AI not to invent pricing", () => {
  const profile = createDemoWorkspace().profile;
  assert.equal(detectUrgency("There is smoke and a gas leak"), "high");
  const prompt = buildReceptionistPrompt(profile);
  assert.match(prompt, /Never invent or estimate prices/);
  assert.match(prompt, /Never invent prices, availability, credentials, bookings, promises, or policies/);
});

test("Gmail messages are encoded without exposing credentials", () => {
  const raw = buildGmailRaw({ from: "team@example.com", to: "owner@example.com", subject: "EverOnn call summary", text: "A customer called." });
  const decoded = Buffer.from(raw, "base64url").toString("utf8");
  assert.match(decoded, /Subject: EverOnn call summary/);
  assert.match(decoded, /A customer called/);
});
