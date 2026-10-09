import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["postgres"],
  outputFileTracingIncludes: {
    "/*": ["./ai/**/*.md"],
  },
  outputFileTracingExcludes: { "/*": ["./data/**/*", "./tests/**/*", "./.env*"] },
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
