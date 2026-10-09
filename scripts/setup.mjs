import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
try {
  const example = await readFile(new URL("../.env.example", import.meta.url), "utf8");
  await writeFile(new URL("../.env.local", import.meta.url), example.replace(/^WAAS_API_KEY=$/m, "WAAS_API_KEY=" + randomBytes(32).toString("hex")), { flag: "wx", mode: 0o600 });
  console.log("Created .env.local with a random access key. Add your Gemini key; set DATABASE_URL for production.");
} catch (error) {
  if (error.code === "EEXIST") console.log(".env.local already exists and was preserved.");
  else throw error;
}
