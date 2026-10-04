import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { appDatabaseConfigured, createAppRecords, type AppQuery } from "../lib/app-records";

const migration = () => readFile(new URL("../supabase/migrations/202610040002_everonn_app.sql", import.meta.url), "utf8");
const workspaceKey = (id: string) => `workspaces/${createHash("sha256").update(id).digest("hex")}`;
async function database() {
  const db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA agentic_that; CREATE SCHEMA everonn_usage; CREATE TABLE public.other_users(id text); INSERT INTO public.other_users VALUES ('existing'); CREATE TABLE agentic_that.documents(id text); INSERT INTO agentic_that.documents VALUES ('retained'); CREATE TABLE everonn_usage.usage_records(key text); INSERT INTO everonn_usage.usage_records VALUES ('existing-usage');");
  return db;
}
function records(db: PGlite) {
  const query: AppQuery = async <T extends Record<string, unknown>>(statement: string, parameters: unknown[] = []) => (await db.query<T>(statement, parameters)).rows;
  return createAppRecords(query, { legacySchema: true });
}

test("application migration preserves other app/usage objects and denies browser/API access", async () => {
  const db = await database();
  try {
    const before = await db.query("SELECT n.nspname, c.relname, c.oid, c.relacl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','agentic_that','everonn_usage') ORDER BY c.oid");
    await db.exec(await migration());
    await db.exec(await migration());
    assert.deepEqual((await db.query("SELECT n.nspname, c.relname, c.oid, c.relacl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','agentic_that','everonn_usage') ORDER BY c.oid")).rows, before.rows);
    assert.deepEqual((await db.query("SELECT * FROM public.other_users")).rows, [{ id: "existing" }]);
    assert.deepEqual((await db.query("SELECT * FROM agentic_that.documents")).rows, [{ id: "retained" }]);
    assert.deepEqual((await db.query("SELECT * FROM everonn_usage.usage_records")).rows, [{ key: "existing-usage" }]);
    for (const role of ["anon", "authenticated", "service_role"]) {
      await db.exec(`SET ROLE ${role}`);
      await assert.rejects(db.query("SELECT * FROM everonn_app.app_records"), /permission denied/);
      await assert.rejects(db.query("SELECT everonn_app.write_app_record('auth/accounts','{}'::jsonb,NULL,true)"), /permission denied/);
      await db.exec("RESET ROLE");
    }
    assert.equal(await records(db).checkMigration(), "202610040002");
  } finally { await db.close(); }
});

test("an existing unrelated application schema stops and keeps its data", async () => {
  const db = await database();
  try {
    await db.exec("CREATE SCHEMA everonn_app; CREATE TABLE everonn_app.existing(id integer); INSERT INTO everonn_app.existing VALUES (7)");
    await assert.rejects(db.exec(await migration()), /already exists without/);
    await db.exec("ROLLBACK");
    assert.deepEqual((await db.query("SELECT * FROM everonn_app.existing")).rows, [{ id: 7 }]);
    assert.equal((await db.query<{ value: string | null }>("SELECT to_regclass('everonn_app.app_records') AS value")).rows[0].value, null);
  } finally { await db.close(); }
});

test("conditional application writes retain concurrent accounts and reject stale/delete-recreate revisions", async () => {
  const db = await database();
  try {
    await db.exec(await migration());
    const a = records(db), b = records(db);
    type Accounts = { users: string[] };
    const validate = (v: unknown): asserts v is Accounts => { assert.ok(Array.isArray((v as Accounts).users)); };
    const results = await Promise.all([a, b].map((store, i) => store.mutate("auth/accounts", () => ({ users: [] }), validate, (value) => { value.users.push(`user_${i}`); return `user_${i}`; })));
    assert.deepEqual(results, ["user_0", "user_1"]);
    assert.deepEqual((await a.read<Accounts>("auth/accounts"))?.data.users.sort(), ["user_0", "user_1"]);
    const first = (await a.read<Accounts>("auth/accounts"))!;
    assert.equal(await a.write("auth/accounts", { users: [] }, { new: true }), false);
    assert.equal(await a.write("auth/accounts", { users: ["updated"] }, { revision: first.revision }), true);
    assert.equal(await b.write("auth/accounts", { users: [] }, { revision: first.revision }), false);
    assert.equal(await b.remove("auth/accounts", first.revision), false);
    const latest = (await a.read("auth/accounts"))!;
    assert.equal(await a.remove("auth/accounts", latest.revision), true);
    assert.equal(await b.write("auth/accounts", { users: ["recreated"] }, { new: true }), true);
    assert.equal(await a.write("auth/accounts", { users: [] }, { revision: latest.revision }), false);
    await assert.rejects(a.write("public/other_users", {}, { new: true }), /Invalid application record key/);
    await assert.rejects(db.query("SELECT everonn_app.write_app_record('auth/accounts','{}'::jsonb,NULL,false)"), /require a revision/);
  } finally { await db.close(); }
});

test("only one concurrent first owner can claim account setup", async () => {
  const db = await database();
  try {
    await db.exec(await migration());
    type Accounts = { users: string[] };
    const validate = (v: unknown): asserts v is Accounts => { assert.ok(Array.isArray((v as Accounts).users)); };
    const results = await Promise.allSettled([records(db), records(db)].map((store, i) => store.mutate("auth/accounts", () => ({ users: [] }), validate, (value) => {
      if (value.users.length) throw new Error("Owner already configured");
      value.users.push(`owner_${i}`);
    })));
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    assert.equal((await records(db).read<Accounts>("auth/accounts"))?.data.users.length, 1);
  } finally { await db.close(); }
});

test("workspace rows remain separate from accounts/providers and survive new store instances", async () => {
  const db = await database();
  try {
    await db.exec(await migration());
    const store = records(db);
    await store.write("workspaces/primary", { workspaceId: "primary", retained: true }, { new: true });
    await store.write(workspaceKey("customer_a"), { workspaceId: "customer_a", contacts: [] }, { new: true });
    await store.write(workspaceKey("customer_b"), { workspaceId: "customer_b", contacts: ["private"] }, { new: true });
    await store.write("providers/google", { version: 1, google: { encrypted: { ciphertext: "fixture" } } }, { new: true });
    const restarted = records(db);
    assert.equal((await restarted.listWorkspaces()).length, 2);
    assert.deepEqual((await restarted.read(workspaceKey("customer_a")))?.data, { workspaceId: "customer_a", contacts: [] });
    await assert.rejects(store.write(workspaceKey("duplicate"), { workspaceId: "primary" }, { new: true }), /duplicate key/);
    assert.equal((await restarted.listWorkspaces()).length, 2);
  } finally { await db.close(); }
});

test("serverless account storage fails closed without a database instead of using local files", () => {
  const old = { url: process.env.SUPABASE_DB_URL, durable: process.env.EVERONN_REQUIRE_DURABLE_STORAGE, aws: process.env.AWS_LAMBDA_FUNCTION_NAME };
  try {
    delete process.env.SUPABASE_DB_URL;
    process.env.EVERONN_REQUIRE_DURABLE_STORAGE = "true";
    assert.throws(appDatabaseConfigured, /requires the server Supabase/);
    process.env.EVERONN_REQUIRE_DURABLE_STORAGE = "false";
    process.env.AWS_LAMBDA_FUNCTION_NAME = "fixture";
    assert.throws(appDatabaseConfigured, /requires the server Supabase/);
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    assert.equal(appDatabaseConfigured(), false);
    process.env.SUPABASE_DB_URL = "configured";
    assert.equal(appDatabaseConfigured(), true);
  } finally {
    for (const [key, value] of [["SUPABASE_DB_URL", old.url], ["EVERONN_REQUIRE_DURABLE_STORAGE", old.durable], ["AWS_LAMBDA_FUNCTION_NAME", old.aws]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
  }
});
