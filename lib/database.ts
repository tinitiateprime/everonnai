import postgres from "postgres";
import { supabaseDatabaseCa } from "./supabase-ca";

let connection: ReturnType<typeof postgres> | undefined;
export function database() {
  if (connection) return connection;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("Set DATABASE_URL to your PostgreSQL connection string.");
  const hostname = new URL(url).hostname;
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
  if (process.env.DATABASE_SSL === "disable" && !local) throw new Error("DATABASE_SSL=disable is allowed only for localhost.");
  const ca = process.env.DATABASE_CA_CERT?.replaceAll("\\n", "\n") || (/\.supabase\.(?:com|co)$/.test(hostname) ? supabaseDatabaseCa : undefined);
  connection = postgres(url, {
    max: 5, prepare: false, connect_timeout: 10, idle_timeout: 20,
    ssl: process.env.DATABASE_SSL === "disable" ? false : { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
  });
  return connection;
}

export async function closeDatabase() {
  const current = connection;
  connection = undefined;
  await current?.end({ timeout: 5 });
}
