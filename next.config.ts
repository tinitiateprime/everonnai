import type { NextConfig } from "next";
const config: NextConfig = {
  distDir:
    process.env.NODE_ENV !== "production" &&
    process.env.PLATFORM_TEST_OUTPUT === "1"
      ? ".next-platform-check"
      : ".next",
  serverExternalPackages: [
    "playwright",
    "@axe-core/playwright",
    "axe-core",
    "pg",
    "openid-client",
    "@electric-sql/pglite",
    "@aws-sdk/client-s3",
  ],
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/api/platform/*": [
      "./db/migrations/*.sql",
      "./ai/capabilities/site-growth-advisor/SKILL.md",
      "./ai/capabilities/website-designer/SKILL.md",
    ],
    "/api/plan": ["./ai/capabilities/website-building/SKILL.md"],
    "/api/generate": ["./ai/capabilities/website-building/SKILL.md"],
    "/api/refine": ["./ai/capabilities/website-building/SKILL.md"],
  },
  outputFileTracingExcludes: {
    "/*": [
      "./.env*",
      "./data/generated-sites/**/*",
      "./data/crawls/**/*",
      "./data/platform/**/*",
      "./artifacts/**/*",
      "./.next-platform-check/**/*",
    ],
  },
};
export default config;
