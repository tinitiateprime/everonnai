import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: ["playwright"],
  poweredByHeader: false,
  outputFileTracingExcludes: {
    "/*": ["./.env*", "./data/generated-sites/**/*", "./artifacts/**/*"],
  },
};
export default config;
