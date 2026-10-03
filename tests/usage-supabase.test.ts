import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createUsageSupabase, usageSupabase } from "../lib/usage-supabase";
import { createUsagePostgres, type UsageQuery } from "../lib/usage-postgres";

const migration = () => readFile(new URL("../supabase/migrations/202610030001_everonn_usage.sql", import.meta.url), "utf8");
const revision = "00000000-0000-0000-0000-000000000001";
const options = { url: "https://fixture.supabase.co", secretKey: "sb_secret_fixture" };
async function database() {
  const db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA agentic_that; CREATE TABLE public.platform_users(id text PRIMARY KEY, name text); INSERT INTO public.platform_users VALUES ('old-user', 'Existing project'); CREATE TABLE agentic_that.app_document_store(key text PRIMARY KEY, value jsonb); INSERT INTO agentic_that.app_document_store VALUES ('old-document', '{\"retained\":true}');");
  return db;
}

test("usage migration preserves existing schemas, data and privileges, and can run twice", async () => {
  const db = await database();
  try {
    const before = await db.query("SELECT n.nspname, c.relname, c.oid, c.relacl FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname IN ('public', 'agentic_that') AND c.relkind = 'r' ORDER BY n.nspname, c.relname");
    const source = await migration();
    await db.exec(source);
    await db.exec(source);
    const after = await db.query("SELECT n.nspname, c.relname, c.oid, c.relacl FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname IN ('public', 'agentic_that') AND c.relkind = 'r' ORDER BY n.nspname, c.relname");
    assert.deepEqual(after.rows, before.rows);
    assert.deepEqual((await db.query("SELECT * FROM public.platform_users")).rows, [{ id: "old-user", name: "Existing project" }]);
    assert.deepEqual((await db.query("SELECT * FROM agentic_that.app_document_store")).rows, [{ key: "old-document", value: { retained: true } }]);
    assert.equal((await db.query("SELECT * FROM everonn_usage.schema_migrations")).rows.length, 1);
    const [security] = (await db.query<{ anon: boolean; authenticated: boolean; server: boolean; rpc: boolean }>("SELECT has_schema_privilege('anon','everonn_usage','USAGE') AS anon, has_schema_privilege('authenticated','everonn_usage','USAGE') AS authenticated, has_table_privilege('service_role','everonn_usage.usage_records','SELECT,INSERT,UPDATE,DELETE') AS server, has_function_privilege('anon','everonn_usage.write_usage_record(text,jsonb,uuid,boolean)','EXECUTE') AS rpc")).rows;
    assert.deepEqual(security, { anon: false, authenticated: false, server: true, rpc: false });
    await db.exec("SET ROLE anon");
    await assert.rejects(db.query("SELECT * FROM everonn_usage.usage_records"), /permission denied/);
    await assert.rejects(db.query("SELECT everonn_usage.write_usage_record('system/probe', '{}'::jsonb)"), /permission denied/);
    await db.exec("RESET ROLE; SET ROLE service_role");
    assert.equal((await db.query<{ accepted: boolean }>("SELECT everonn_usage.write_usage_record('system/probe', '{}'::jsonb) AS accepted")).rows[0].accepted, true);
  } finally { await db.close(); }
});

test("unrecognized existing usage schema stops before changing any existing data", async () => {
  const db = await database();
  try {
    await db.exec("CREATE SCHEMA everonn_usage; CREATE TABLE everonn_usage.unrelated(id integer); INSERT INTO everonn_usage.unrelated VALUES (7)");
    await assert.rejects(db.exec(await migration()), /unrecognized objects/);
    await db.exec("ROLLBACK");
    assert.deepEqual((await db.query("SELECT * FROM everonn_usage.unrelated")).rows, [{ id: 7 }]);
    assert.equal((await db.query<{ target: string | null }>("SELECT to_regclass('everonn_usage.usage_records') AS target")).rows[0].target, null);
  } finally { await db.close(); }
});

test("PostgreSQL usage writes reject stale/create conflicts, preserve scope, and paginate", async () => {
  const db = await database();
  try {
    await db.exec(await migration());
    let writeTypesChecked = false;
    const query: UsageQuery = async <T extends Record<string, unknown>>(statement: string, parameters: unknown[] = []) => {
      if (statement.includes("write_usage_record") && !writeTypesChecked) {
        await db.exec(`PREPARE usage_write AS ${statement}`);
        const [prepared] = (await db.query<{ types: string }>("SELECT parameter_types::text AS types FROM pg_prepared_statements WHERE name = 'usage_write'")).rows;
        assert.equal(prepared.types, "{text,text,uuid,boolean}", "JSON must travel as text so the real driver cannot encode it twice");
        writeTypesChecked = true;
      }
      return (await db.query<T>(statement, parameters)).rows;
    };
    const store = createUsagePostgres(query);
    assert.equal(await store.checkMigration(), "202610030001");
    assert.equal(await store.write("events/ws_1/a", { workspaceId: "ws_1", value: 1 }, { new: true }), true);
    assert.equal(await store.write("events/ws_1/a", { value: 99 }, { new: true }), false);
    const first = (await store.read<{ value: number }>("events/ws_1/a"))!;
    assert.equal(await store.write("events/ws_1/a", { workspaceId: "ws_1", value: 2 }, { revision: first.revision }), true);
    assert.equal(await store.write("events/ws_1/a", { value: 99 }, { revision: first.revision }), false);
    await store.remove("events/ws_1/a");
    await store.write("events/ws_1/a", { workspaceId: "ws_1", value: 3 }, { new: true });
    assert.equal(await store.write("events/ws_1/a", { value: 99 }, { revision: first.revision }), false, "delete/recreate must not reuse an earlier revision");
    await db.exec("INSERT INTO everonn_usage.usage_records(key, payload) SELECT 'events/ws_1/event_' || lpad(i::text, 4, '0'), jsonb_build_object('workspaceId','ws_1','value',i) FROM generate_series(1,1100) i; INSERT INTO everonn_usage.usage_records(key,payload) VALUES ('events/wsX1/foreign', '{\"workspaceId\":\"foreign\"}')");
    assert.equal((await store.list("events/ws_1")).length, 1101, "literal underscore scope and all pages must be preserved");
    assert.equal((await store.read<{ value: number }>("events/ws_1/a"))?.data.value, 3);
    await assert.rejects(store.write("../public/platform_users", {}), /Invalid usage record key/);
    assert.equal((await db.query<{ count: number }>("SELECT count(*)::integer AS count FROM public.platform_users")).rows[0].count, 1);
  } finally { await db.close(); }
});

test("Supabase Data API uses only the usage schema and paginates below the project row limit", async () => {
  const calls: URL[] = [];
  const store = createUsageSupabase({ ...options, fetch: (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)); calls.push(url);
    assert.equal(new Headers(init?.headers).get("Accept-Profile"), "everonn_usage");
    assert.equal(new Headers(init?.headers).get("Content-Profile"), "everonn_usage");
    assert.equal(new Headers(init?.headers).get("Authorization"), null, "new secret keys use apikey, not a fabricated JWT");
    if (calls.length <= 2) return Response.json([{ key: `events/ws/${calls.length}`, payload: { value: calls.length }, revision }]);
    return Response.json([]);
  }) as typeof fetch });
  assert.deepEqual(await store.list("events/ws"), [{ value: 1 }, { value: 2 }]);
  assert.equal(calls[1].searchParams.getAll("key")[1], "gt.events/ws/1");
  assert.equal(calls.length, 3);
});

test("Supabase RPC conditions and database errors cannot expose keys or raw payloads", async () => {
  const writes: Record<string, unknown>[] = [];
  const store = createUsageSupabase({ ...options, fetch: (async (_input: unknown, init?: RequestInit) => { writes.push(JSON.parse(String(init?.body))); return Response.json(writes.length === 1); }) as typeof fetch });
  assert.equal(await store.write("events/ws/a", {}, { new: true }), true);
  assert.equal(await store.write("events/ws/a", {}, { revision }), false);
  assert.equal(writes[0].p_insert_only, true);
  assert.equal(writes[1].p_expected_revision, revision);
  const unavailable = createUsageSupabase({ ...options, fetch: (async () => Response.json({ code: "PGRST106", message: options.secretKey, details: "customer contents" }, { status: 406 })) as typeof fetch });
  await assert.rejects(unavailable.read("events/ws/a"), (error: Error) => /Exposed schemas/.test(error.message) && !error.message.includes(options.secretKey) && !error.message.includes("customer contents"));
  const badPage = createUsageSupabase({ ...options, fetch: (async () => Response.json([{ key: "events/foreign/a", payload: {}, revision }])) as typeof fetch });
  await assert.rejects(badPage.list("events/ws"), /scope or cursor mismatch/);
});

test("shared Supabase schemas and public keys are rejected before contacting the database", () => {
  assert.throws(() => createUsageSupabase({ ...options, schema: "agentic_that" }), /other project schemas/);
  assert.throws(() => createUsageSupabase({ ...options, schema: "public" }), /other project schemas/);
  assert.throws(() => createUsageSupabase({ ...options, secretKey: "sb_publishable_fixture" }), /server secret key/);
  const previous = process.env.SUPABASE_USAGE_SCHEMA;
  process.env.SUPABASE_USAGE_SCHEMA = "public";
  try { assert.throws(usageSupabase, /other project schemas/); }
  finally { if (previous === undefined) delete process.env.SUPABASE_USAGE_SCHEMA; else process.env.SUPABASE_USAGE_SCHEMA = previous; }
});
