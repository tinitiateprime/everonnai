// node --env-file=.env.local examples/export.mjs SITE_ID ./exported-site
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createWaasClient } from "../sdk/index.mjs";
const [siteId, directory = "./exported-site"] = process.argv.slice(2);
if (!siteId) throw new Error("Pass the published site ID.");
const waas = createWaasClient({ baseUrl: process.env.WAAS_PUBLIC_URL || "http://localhost:3000", apiKey: process.env.WAAS_API_KEY });
const bundle = await waas.exportSite(siteId);
const root = path.resolve(directory);
for (const page of bundle.pages) {
  const file = path.resolve(root, page.path);
  if (!file.startsWith(root + path.sep)) throw new Error("Invalid export path.");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, page.html, "utf8");
}
console.log("Wrote " + bundle.pages.length + " HTML pages to " + root);
