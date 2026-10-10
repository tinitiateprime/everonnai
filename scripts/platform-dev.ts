import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd(), true);
const port = process.env.PLATFORM_DEV_PORT || "3000";
if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535)
  throw new Error("PLATFORM_DEV_PORT must be a port from 1024 to 65535.");
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    port,
  ],
  {
    stdio: "inherit",
    windowsHide: true,
    env: {
      ...process.env,
      NODE_ENV: "development",
      PLATFORM_LOCAL_MODE: "1",
      PLATFORM_DEV_AUTH: "1",
      AUTH_BASE_URL: `http://localhost:${port}`,
      AUTH_SESSION_SECRET:
        process.env.AUTH_SESSION_SECRET || randomBytes(32).toString("hex"),
    },
  },
);
console.log(`Local project workspace: http://localhost:${port}/projects`);
child.on("exit", (code) => {
  process.exitCode = code ?? 0;
});
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
