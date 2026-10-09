import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: ["playwright"],
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/api/plan": ["./ai/capabilities/website-building/SKILL.md"],
    "/api/generate": ["./ai/capabilities/website-building/SKILL.md"],
    "/api/refine": ["./ai/capabilities/website-building/SKILL.md"],
  },
  outputFileTracingExcludes: {
    "/*": [
      "./.env*",
      "./data/generated-sites/**/*",
      "./data/crawls/**/*",
      "./artifacts/**/*",
    ],
  },
};
export default config;
