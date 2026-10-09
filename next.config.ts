import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["postgres", "mysql2"],
  outputFileTracingIncludes: {
    "/api/*": ["./ai/**/*.md"],
  },
  outputFileTracingExcludes: {
    "/workspace": ["./data/project-repositories.json"],
    "/api/project-workspace": ["./data/project-repositories.json"],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.pexels.com",
        port: "",
        pathname: "/photos/**",
      },
    ],
  },
};

export default nextConfig;
