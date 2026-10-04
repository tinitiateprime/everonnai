import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Real production routes and PostgreSQL-engine persistence in a disposable
// local PGlite database. No shared Supabase connection or provider is contacted.
async function main() {
  const directory = await mkdtemp(path.join(tmpdir(), "everonn-auth-db-smoke-"));
  const port = Number(process.env.SMOKE_AUTH_PORT || 3000);
  const origin = `http://localhost:${port}`;
  const probe = createServer();
  await new Promise<void>((resolve, reject) => { probe.once("error", reject); probe.listen(port, () => probe.close(() => resolve())); });
  const require = createRequire(import.meta.url);
  const migration = (await Promise.all(["202610030001_everonn_usage.sql", "202610040002_everonn_app.sql", "202610040003_everonn_relational.sql"].map(name => readFile(new URL("../supabase/migrations/" + name, import.meta.url), "utf8")))).join("\n");
  const preload = path.join(directory, "database-preload.cjs");
  const driver = path.join(directory, "database-driver.mjs");
  await writeFile(driver, "export default function postgres(){return globalThis.__everonnSmokeDatabaseDriver();}\n");
  await writeFile(preload, `
const {PGlite}=require(${JSON.stringify(require.resolve("@electric-sql/pglite"))});
const Module=require('node:module');
const fs=require('node:fs/promises');
const path=require('node:path');
const db=new PGlite(process.env.SMOKE_APP_DB_DIR);
const ready=(async()=>{
  const table=(await db.query("SELECT to_regclass('everonn.users') AS value")).rows[0].value;
  if(!table){
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
    await db.exec(${JSON.stringify(migration)});
  }
})();
const originalLoad=Module._load;
globalThis.__everonnSmokeDatabaseDriver=()=>({unsafe:async(statement,parameters=[])=>{await ready;return(await db.query(statement,parameters)).rows;},end:async()=>{}});
Module._load=function(request,parent,isMain){
  if(request==='postgres')return globalThis.__everonnSmokeDatabaseDriver;
  return originalLoad.call(this,request,parent,isMain);
};
Module.registerHooks({resolve(specifier,context,nextResolve){
  if(/^postgres(?:-[a-f0-9]+)?$/.test(specifier))return{url:${JSON.stringify(pathToFileURL(driver).href)},shortCircuit:true};
  return nextResolve(specifier,context);
}});
for(const method of ['writeFile','mkdir','rename','copyFile','unlink']){
  const original=fs[method];
  fs[method]=async function(file,...args){
    if(path.resolve(String(file)).startsWith(path.resolve(process.env.SMOKE_READ_ONLY_DIR)+path.sep))throw Object.assign(new Error('Read-only application directory'),{code:'EROFS'});
    return original.call(this,file,...args);
  };
}
process.on('message',async(message)=>{if(message?.type==='close-smoke-database'){await ready;await db.close();process.send?.({type:'smoke-database-closed'});}});
`);
  const environment: NodeJS.ProcessEnv = {
    ...process.env, NODE_ENV: "production", NEXT_PUBLIC_APP_URL: origin,
    EVERONN_AUTH_SETUP_TOKEN: "auth-database-smoke-setup", EVERONN_REQUIRE_DURABLE_STORAGE: "true",
    SUPABASE_DB_URL: "postgres://fixture:fixture@127.0.0.1:1/disposable", SUPABASE_USAGE_SCHEMA: "everonn_usage",
    SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SECRET_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "",
    SMOKE_APP_DB_DIR: path.join(directory, "database"), SMOKE_READ_ONLY_DIR: path.join(directory, "read-only"),
    EVERONN_AUTH_FILE: path.join(directory, "read-only", "auth.json"), EVERONN_WORKSPACES_FILE: path.join(directory, "read-only", "workspaces.json"),
    EVERONN_CONNECTIONS_FILE: path.join(directory, "read-only", "connections.json"), EVERONN_DATA_FILE: path.join(directory, "read-only", "workspace.json"),
    NETLIFY: "false", NETLIFY_BLOBS_CONTEXT: "", AWS_LAMBDA_FUNCTION_NAME: "fixture", USAGE_BACKGROUND_MODE: "external",
    GEMINI_API_KEY: "", GOOGLE_API_KEY: "", ELEVENLABS_API_KEY: "", ELEVENLABS_AGENT_ID: "", PEXELS_API_KEY: "",
    GOOGLE_OAUTH_CLIENT_ID: "", GOOGLE_OAUTH_CLIENT_SECRET: "", CREDENTIAL_ENCRYPTION_KEY: "", GEMINI_BILLING_SERVICE_ACCOUNT_BASE64: "",
  };
  let server: ChildProcess | undefined;
  let logs = "";
  async function start() {
    logs = "";
    server = spawn(process.execPath, ["--require", preload, "node_modules/next/dist/bin/next", "start", "--port", String(port)], {
      env: environment, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    server.stdout?.on("data", (chunk) => { logs = (logs + chunk.toString()).slice(-12000); });
    server.stderr?.on("data", (chunk) => { logs = (logs + chunk.toString()).slice(-12000); });
    for (let attempt = 0; attempt < 80; attempt++) {
      if (await fetch(`${origin}/login`, { signal: AbortSignal.timeout(5000) }).then((r) => r.ok).catch(() => false)) return;
      if (server.exitCode !== null || server.signalCode !== null || attempt === 79) throw new Error(`Authentication test server failed: ${logs}`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  async function stop() {
    const child = server;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 5000);
      child.on("message", (message) => { if ((message as { type?: string }).type === "smoke-database-closed") { clearTimeout(timer); resolve(); } });
      child.send({ type: "close-smoke-database" }, () => {});
    });
    child.kill();
    await new Promise<void>((resolve) => { if (child.exitCode !== null) resolve(); else child.once("exit", () => resolve()); });
    server = undefined;
  }
  async function request(route: string, method = "GET", body?: unknown, cookie?: string, workspaceId?: string) {
    return fetch(origin + route, {
      method, signal: AbortSignal.timeout(15000), headers: { Origin: origin, ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(workspaceId ? { "x-everonn-workspace": workspaceId } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }
  const cookieFor = (response: Response) => { const cookie = response.headers.get("set-cookie")?.split(";")[0]; assert.ok(cookie); return cookie; };
  const password = "AuthDatabaseFixture123!";
  try {
    await start();
    assert.equal((await request("/api/workspace")).status, 401);
    const ownerInput = { name: "Database Owner", email: "owner@example.com", password, setupToken: "auth-database-smoke-setup" };
    assert.equal((await request("/api/auth/setup", "POST", { ...ownerInput, setupToken: "incorrect" })).status, 403);
    const owner = await request("/api/auth/setup", "POST", ownerInput);
    assert.equal(owner.status, 201, await owner.clone().text());
    const ownerCookie = cookieFor(owner);
    const initial = await request("/api/workspace", "GET", undefined, ownerCookie);
    assert.equal(initial.status, 200, await initial.clone().text());
    const saved = await initial.json();
    assert.equal(saved.persistence, "supabase-postgres");
    saved.workspace.profile.businessName = "Persisted after restart";
    const changed = await request("/api/workspace", "PUT", { workspace: saved.workspace }, ownerCookie);
    assert.equal(changed.status, 200, await changed.clone().text());
    const customerInput = { name: "Customer Owner", email: "customer@example.com", password, businessName: "Separate Business", businessType: "Services" };
    const customer = await request("/api/auth/register", "POST", customerInput);
    assert.equal(customer.status, 201, await customer.clone().text());
    const customerCookie = cookieFor(customer);
    const customerWorkspace = await (await request("/api/workspace", "GET", undefined, customerCookie)).json();
    assert.notEqual(customerWorkspace.workspace.workspaceId, saved.workspace.workspaceId);
    assert.deepEqual(customerWorkspace.workspace.contacts, []);
    assert.equal((await request("/api/workspace", "GET", undefined, customerCookie, saved.workspace.workspaceId)).status, 403);
    assert.equal((await request("/api/auth/register", "POST", customerInput)).status, 409);
    assert.notEqual((await request("/api/auth/setup", "POST", ownerInput)).status, 201);
    await stop();
    await start();
    const retained = await request("/api/workspace", "GET", undefined, ownerCookie);
    assert.equal(retained.status, 200, await retained.clone().text());
    assert.equal((await retained.json()).workspace.profile.businessName, "Persisted after restart");
    assert.equal((await request("/api/workspace", "GET", undefined, customerCookie)).status, 200);
    assert.equal((await request("/api/auth/login", "POST", { email: ownerInput.email, password })).status, 200);
    assert.equal((await request("/api/auth/login", "POST", { email: ownerInput.email, password: "incorrect" })).status, 401);
    const page = await (await fetch(origin + "/login")).text();
    assert.ok(!page.includes("Owner setup token"));
    console.log(JSON.stringify({ ownerCreated: true, customerCreated: true, workspaceSaved: true, sessionsAndDataSurviveRestart: true, tenantIsolation: true, fileWritesBlocked: true, sharedSupabaseContacted: false }));
  } catch (error) {
    console.error(logs);
    throw error;
  } finally { await stop(); await rm(directory, { recursive: true, force: true }); }
}
main().catch((error: Error) => { console.error(error.message); process.exitCode = 1; });
