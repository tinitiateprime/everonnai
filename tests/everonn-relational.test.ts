import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createAppRecords, type AppQuery } from "../lib/app-records";
import { createUsagePostgres } from "../lib/usage-postgres";
import { saveWebsiteMemory, EMPTY_WEBSITE_PREFERENCES } from "../features/agent-runtime/memory";

const migration = (name: string) => readFile(new URL("../supabase/migrations/" + name, import.meta.url), "utf8");
const keyFor = (id: string) => "workspaces/" + createHash("sha256").update(id).digest("hex");
async function legacyDatabase() {
  const db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA agentic_that; CREATE TABLE agentic_that.documents(id text PRIMARY KEY, body jsonb); INSERT INTO agentic_that.documents VALUES ('existing','{\"keep\":true}'); CREATE TABLE public.other_users(id text); INSERT INTO public.other_users VALUES ('existing');");
  await db.exec(await migration("202610030001_everonn_usage.sql"));
  await db.exec(await migration("202610040002_everonn_app.sql"));
  return db;
}
const core = () => migration("202610040003_everonn_relational.sql");
const queryFor = (db: PGlite): AppQuery => async <T extends Record<string, unknown>>(statement: string, parameters: unknown[] = []) => (await db.query<T>(statement, parameters)).rows;
async function workspace(id = "test_primary") {
  const seed = JSON.parse(await readFile(new URL("../data/everonn.json", import.meta.url), "utf8"));
  seed.workspaceId = id; seed.profile.workspaceId = id;
  for (const collection of ["contacts","leads","conversations","appointments"]) for (const row of seed[collection]) row.workspaceId = id;
  if (seed.websiteProject) seed.websiteProject.workspaceId = id;
  // Nonempty nested collections exercise extraction, ordering, and optional fields.
  seed.conversations = [{id:"conversation_1",workspaceId:id,channel:"chat",status:"completed",summary:"fixture",
    messages:[{id:"m2",role:"user",text:"Hello",at:"2026-10-04T01:00:00Z"},{id:"m1",role:"assistant",text:"Welcome",at:"2026-10-04T01:00:01Z"}]}];
  seed.websiteProject = { id:"website_1",workspaceId:id,status:"draft",publicSlug:"fixture-site",spec:{nested:["retained"]} };
  seed.publishedWebsite = { id: "release_1", project: { ...seed.websiteProject, status: "published", spec: { code: { schemaVersion: 1, concepts: { editorial: { css: ".site{display:grid}", pages: [{ path: "/", html: "<main>Saved generated page</main>" }] } } } } }, profile: structuredClone(seed.profile), publishedAt: "2026-10-04T01:00:00Z" };
  seed.websiteReleases = [{ ...structuredClone(seed.publishedWebsite), id: "release_0" }];
  seed.extraFixture = {keep:true};
  seed.websiteGeneration = { version: 1, workspaceId: id, id: "00000000-0000-0000-0000-000000000001", status: "running",
    progress: { stage: "code", completedPages: 1, totalPages: 21 }, checkpoint: { fingerprint: "retained", profile: structuredClone(seed.profile), models: ["fixture-model"], conceptIndex: 0, contentAttempt: { modelIndex: 0, validationAttempt: 0 }, designs: { editorial: { css: ".site{display:grid}", pages: [{ path: "/", html: "<main>Saved AI page</main>" }] } } } };
  seed.aiMemory = saveWebsiteMemory({ profile: seed.profile, actor: { workspaceId: id, role: "owner", userId: "fixture-owner" }, preferences: { ...EMPTY_WEBSITE_PREFERENCES, brief: "Black and gold", rejected: ["Technician stock photos"] } });
  return seed;
}
const account = (workspaceId = "test_primary", id = "owner_1") => ({
  userId:id,memberId:"member_"+id,workspaceId,name:"Fixture owner",email:id+"@example.test",role:"owner",
  passwordHash:"fixture-password-hash",status:"active",failedLoginCount:0,createdAt:"2026-10-04T01:00:00Z",updatedAt:"2026-10-04T01:00:00Z"
});
const accounts = (workspaceId = "test_primary") => ({version:1,extraFixture:{keep:true},users:[account(workspaceId)],
  sessions:[{tokenHash:"fixture-token-hash",userId:"owner_1",workspaceId,createdAt:"2026-10-04T01:00:00Z",expiresAt:"2026-10-05T01:00:00Z"}],
  invitations:[{tokenHash:"invite-hash",workspaceId,memberId:"invited",name:"Invited",email:"invite@example.test",role:"viewer",createdByUserId:"owner_1",createdAt:"2026-10-04T01:00:00Z",expiresAt:"2026-10-05T01:00:00Z"}]});

test("consolidation preserves all records, revisions, other project data and permissions; rerunning is safe", async () => {
  const db = await legacyDatabase();
  try {
    const q = queryFor(db);
    const app = createAppRecords(q, {legacySchema:true}), usage = createUsagePostgres(q, {legacySchema:true});
    const w = await workspace(), auth = accounts(), provider = {version:1,google:{test_primary:{version:1,ciphertext:"encrypted-fixture",iv:"fixture",tag:"fixture"}}};
    for (const [key,value] of [["workspaces/primary",w],["auth/accounts",auth],["providers/google",provider]] as const) await app.write(key,value,{new:true});
    const entries = [
      ["events/a",{id:"a",workspaceId:w.workspaceId,provider:"gemini",feature:"chat",tokens:{total:23,input:20,output:3}}],
      ["sessions/a",{id:"a",workspaceId:w.workspaceId,complete:false}],
      ["outbox/a",{id:"a",workspaceId:w.workspaceId}],["claims/a",{workspaceId:w.workspaceId,eventId:"a"}],
      ["billing/a",{refreshedAt:"2026-10-04"}],["system/worker",{checked:1}],
      ["system/job-auth/a",{acceptedAt:"2026-10-04"}],["system/webhooks/a",{receivedAt:"2026-10-04"}],["system/other",{keep:true}]
    ] as const;
    for (const [key,value] of entries) await usage.write(key,value,{new:true});
    const appBefore = (await db.query("SELECT key,payload,revision,created_at,updated_at FROM everonn_app.app_records ORDER BY key")).rows;
    const usageBefore = (await db.query("SELECT key,payload,revision,created_at,updated_at FROM everonn_usage.usage_records ORDER BY key")).rows;
    const metadataQuery = "SELECT n.nspname,c.relname,c.oid,c.relacl,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('agentic_that','public') ORDER BY c.oid";
    const otherBefore = (await db.query(metadataQuery)).rows;
    await db.exec(await core());
    assert.deepEqual((await db.query("SELECT key,payload,revision,created_at,updated_at FROM everonn.app_records ORDER BY key")).rows,appBefore);
    assert.deepEqual((await db.query("SELECT key,payload,revision,created_at,updated_at FROM everonn.usage_records ORDER BY key")).rows,usageBefore);
    assert.deepEqual((await db.query(metadataQuery)).rows,otherBefore);
    assert.deepEqual((await db.query("SELECT * FROM agentic_that.documents")).rows,[{id:"existing",body:{keep:true}}]);
    assert.deepEqual((await db.query("SELECT * FROM public.other_users")).rows,[{id:"existing"}]);
    assert.deepEqual((await createAppRecords(q).read("auth/accounts"))?.data,auth);
    assert.equal((await db.query<{email:string}>("SELECT email,password_hash FROM everonn.users")).rows[0].email,"owner_1@example.test");
    assert.equal((await db.query<{total_tokens:number}>("SELECT total_tokens FROM everonn.usage_events")).rows[0].total_tokens,23);
    assert.equal((await db.query("SELECT * FROM everonn.conversation_messages")).rows.length,2);
    assert.equal((await db.query("SELECT * FROM everonn.business_services")).rows.length,w.profile.services.length);
    assert.equal((await db.query("SELECT * FROM everonn.contacts")).rows.length,w.contacts.length);
    assert.equal((await db.query("SELECT * FROM everonn.appointments")).rows.length,w.appointments.length);
    assert.equal((await db.query<{count:number}>("SELECT count(*)::int AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('everonn_app','everonn_usage') AND c.relkind='r'")).rows[0].count,0);
    await db.exec(await core());
    assert.deepEqual((await db.query("SELECT key,payload,revision,created_at,updated_at FROM everonn.app_records ORDER BY key")).rows,appBefore);
    assert.deepEqual((await db.query(metadataQuery)).rows,otherBefore);
    assert.equal(await createAppRecords(q).checkMigration(),"202610040003");
    assert.equal(await createUsagePostgres(q).checkMigration(),"202610040003");
  } finally { await db.close(); }
});

test("normalized stores and legacy aliases share CAS, tenant scope, removals and registration reservations", async () => {
  const db = await legacyDatabase();
  try {
    await db.exec(await core());
    const q = queryFor(db), app = createAppRecords(q), old = createAppRecords(q,{legacySchema:true});
    const w = await workspace();
    await app.write("workspaces/primary",w,{new:true});
    const initial = (await app.read<typeof w>("workspaces/primary"))!;
    w.contacts = w.contacts.slice(1);
    assert.equal(await old.write("workspaces/primary",w,{revision:initial.revision}),true);
    assert.equal(await app.write("workspaces/primary",initial.data,{revision:initial.revision}),false);
    assert.equal((await db.query("SELECT * FROM everonn.contacts")).rows.length,w.contacts.length);
    const latest = (await app.read<typeof w>("workspaces/primary"))!;
    const invalid = structuredClone(w); invalid.contacts = [{id:"bad",workspaceId:"other"}];
    await assert.rejects(app.write("workspaces/primary",invalid,{revision:latest.revision}),/check constraint/);
    assert.deepEqual((await app.read("workspaces/primary"))?.data,w);
    const changedId = structuredClone(w); changedId.workspaceId = "other"; changedId.profile.workspaceId = "other";
    await assert.rejects(app.write("workspaces/primary",changedId,{revision:latest.revision}),/identity cannot change/);
    const auth = accounts("new_customer");
    await old.write("auth/accounts",auth,{new:true});
    assert.equal((await app.listWorkspaces()).length,0);
    const newWorkspace = await workspace("new_customer");
    await old.write(keyFor("new_customer"),newWorkspace,{new:true});
    assert.equal((await app.listWorkspaces()).length,1);
    const currentAuth = (await app.read<typeof auth>("auth/accounts"))!;
    const second = structuredClone(auth); second.users.push(account("new_customer","owner_2")); second.sessions=[];
    assert.equal(await app.write("auth/accounts",second,{revision:currentAuth.revision}),true);
    assert.equal(await old.write("auth/accounts",auth,{revision:currentAuth.revision}),false);
    assert.equal((await db.query("SELECT * FROM everonn.users")).rows.length,2);
    const usage = createUsagePostgres(q), oldUsage=createUsagePostgres(q,{legacySchema:true});
    await usage.write("events/test",{id:"test",provider:"elevenlabs",voice:{credits:13,durationSeconds:4}}, {new:true});
    const event=(await usage.read("events/test"))!;
    assert.equal(await oldUsage.write("events/test",{id:"test"},{revision:event.revision}),true);
    assert.equal(await usage.write("events/test",{id:"stale"},{revision:event.revision}),false);
    await oldUsage.remove("events/test");
    assert.equal(await usage.read("events/test"),null);
    await usage.write("system/job-auth/old",{acceptedAt:"2026-10-01"});
    await db.exec("DELETE FROM everonn_usage.usage_records WHERE key LIKE 'system/job-auth/%'");
    assert.equal(await usage.read("system/job-auth/old"),null);
    const detached=await workspace("detached");
    await app.write(keyFor("detached"),detached,{new:true});
    const snapshot=(await app.read(keyFor("detached")))!;
    assert.equal(await old.remove(keyFor("detached"),snapshot.revision),true);
    assert.equal((await db.query("SELECT * FROM everonn.contacts WHERE workspace_id='detached'")).rows.length,0);
  } finally { await db.close(); }
});

test("private normalized account tables deny browser and service-role access; service role can meter only", async () => {
  const db = await legacyDatabase();
  try {
    await db.exec(await core());
    for (const role of ["anon","authenticated","service_role"]) {
      await db.exec("SET ROLE "+role);
      for (const table of ["users","auth_sessions","invitations","provider_connections","contacts","app_records","legacy_app_records","legacy_usage_records"]) {
        await assert.rejects(db.query("SELECT * FROM everonn."+table),/permission denied/);
      }
      await assert.rejects(db.query("SELECT everonn.write_app_record('auth/accounts','{}',NULL,true)"),/permission denied/);
      if (role!=="service_role") {
        await assert.rejects(db.query("SELECT * FROM everonn.usage_events"),/permission denied/);
      } else {
        const usage = createUsagePostgres(queryFor(db));
        await usage.write("events/service",{id:"service",workspaceId:"fixture",tokens:{total:12}},{new:true});
        assert.equal((await usage.read<{id:string}>("events/service"))?.data.id,"service");
        await usage.remove("events/service");
      }
      await db.exec("RESET ROLE");
    }
  } finally { await db.close(); }
});

test("collision with an unrelated everonn schema rolls back without changing any existing data", async () => {
  const db=await legacyDatabase();
  try {
    await db.exec("CREATE SCHEMA everonn; CREATE TABLE everonn.unrelated(id integer); INSERT INTO everonn.unrelated VALUES(7)");
    await assert.rejects(db.exec(await core()),/Unrecognized everonn schema/);
    await db.exec("ROLLBACK");
    assert.deepEqual((await db.query("SELECT * FROM everonn.unrelated")).rows,[{id:7}]);
    assert.equal((await db.query<{value:string|null}>("SELECT to_regclass('everonn.users') AS value")).rows[0].value,null);
  } finally { await db.close(); }
});
