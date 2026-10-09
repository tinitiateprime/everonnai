import { mkdir, readFile, rename, writeFile, readdir, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { database } from "./database";

const queues = new Map<string, Promise<unknown>>();
type SqlExecutor = { unsafe: (query: string, parameters: string[]) => PromiseLike<Array<{ payload?: unknown }>> };
const root = () => path.resolve(/* turbopackIgnore: true */ process.env.WAAS_DATA_DIR || path.join(process.cwd(), "data"));
function localFile(key: string) {
  if (!/^[a-z0-9_-]+\/[a-z0-9_-]+$/.test(key)) throw new Error("Invalid storage key.");
  if (process.env.NODE_ENV === "production" && process.env.WAAS_ALLOW_LOCAL_STORAGE !== "true") throw Object.assign(new Error("Configure DATABASE_URL for production, or explicitly enable WAAS_ALLOW_LOCAL_STORAGE on a single server with a persistent volume."), { status: 503 });
  return path.join(root(), key + ".json");
}

export async function readRecord<T>(key: string): Promise<T | null> {
  if (process.env.DATABASE_URL?.trim()) {
    const rows = await database().unsafe("select payload from waas.records where key = $1", [key]);
    return (rows[0]?.payload as T) || null;
  }
  try { return JSON.parse(await readFile(localFile(key), "utf8")) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

export async function listRecords<T>(group: string): Promise<T[]> {
  if (!/^[a-z0-9_-]+$/.test(group)) throw new Error("Invalid storage group.");
  if (process.env.DATABASE_URL?.trim()) {
    const rows = await database().unsafe("select payload from waas.records where key like $1 order by key", [group + "/%"]);
    return rows.map((row) => row.payload as T);
  }
  const directory = path.dirname(localFile(group + "/probe"));
  let files: string[];
  try { files = await readdir(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const items = await Promise.all(files.filter((file) => /^[a-z0-9_-]+\.json$/.test(file)).map((file) => readRecord<T>(group + "/" + file.slice(0, -5))));
  return items.filter((item) => item !== null) as T[];
}

// A placeholder insert plus row lock also serializes first inserts. It never commits on failure.
export async function changeDatabaseRecord<T>(sql: SqlExecutor, key: string, change: (current: T | null) => T) {
  await sql.unsafe("insert into waas.records (key, payload) values ($1, '{}'::jsonb) on conflict (key) do nothing", [key]);
  const rows = await sql.unsafe("select payload from waas.records where key = $1 for update", [key]);
  const payload = rows[0]?.payload;
  const next = change(payload && Object.keys(payload).length ? payload as T : null);
  await sql.unsafe("insert into waas.records (key, payload) values ($1, $2::jsonb) on conflict (key) do update set payload = excluded.payload, updated_at = now()", [key, JSON.stringify(next)]);
  return next;
}
export async function updateRecord<T>(key: string, change: (current: T | null) => T): Promise<T> {
  if (process.env.DATABASE_URL?.trim()) {
    return await database().begin((sql) => changeDatabaseRecord(sql, key, change)) as T;
  }
  const file = localFile(key);
  const previous = queues.get(file) || Promise.resolve();
  const operation = previous.catch(() => undefined).then(async () => {
    const next = change(await readRecord<T>(key));
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = file + "." + randomUUID() + ".tmp";
    try { await writeFile(temporary, JSON.stringify(next), { mode: 0o600 }); await rename(temporary, file); }
    finally { await unlink(temporary).catch(() => undefined); }
    return next;
  });
  queues.set(file, operation);
  try { return await operation; } finally { if (queues.get(file) === operation) queues.delete(file); }
}

export async function removeRecord(key: string) {
  if (process.env.DATABASE_URL?.trim()) { await database().unsafe("delete from waas.records where key = $1", [key]); return; }
  await unlink(localFile(key)).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
}
