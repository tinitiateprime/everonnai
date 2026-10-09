import { cp } from "node:fs/promises";
await cp(".next/static", ".next/standalone/.next/static", { recursive: true });
console.log("Standalone static assets are ready. Start with node .next/standalone/server.js.");
