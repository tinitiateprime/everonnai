import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID, generateKeyPairSync, sign } from "node:crypto";
import * as oidc from "openid-client";
import type { S3Client } from "@aws-sdk/client-s3";
import {
  embeddedDatabase,
  actorTransaction,
  type PlatformDatabase,
} from "../lib/platform/database";
import { migrateDatabase } from "../lib/platform/migrations";
import {
  createSession,
  revokeSession,
  sessionActor,
  sessionHash,
} from "../lib/auth/sessions";
import { encodeFlow, decodeFlow, finishOidcLogin } from "../lib/auth/oidc";
import {
  createTenant,
  createProject,
  listProjects,
  projectDetail,
  projectTransaction,
} from "../lib/projects/service";
import {
  LocalObjectStore,
  S3ObjectStore,
  digest,
  saveArtifact,
  loadArtifact,
} from "../lib/storage/artifacts";
import { platformRequest } from "../lib/platform/http";

test("project foundation uses real SQL isolation, immutable private artifacts and authenticated APIs", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "everonn-platform-test-"),
  );
  const originalEnv = { ...process.env };
  Object.assign(process.env, { NODE_ENV: "test" });
  process.env.PLATFORM_LOCAL_MODE = "1";
  process.env.PLATFORM_DEV_AUTH = "1";
  process.env.AUTH_BASE_URL = "http://localhost:3000";
  process.env.AUTH_SESSION_SECRET =
    "platform-test-only-secret-32-characters-long";
  const db = await embeddedDatabase();
  const store = new LocalObjectStore(path.join(directory, "objects"));
  t.after(async () => {
    await db.close();
    for (const key of Object.keys(process.env))
      if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith("everonn-platform-test-"));
    await rm(resolved, { recursive: true, force: true });
  });
  assert.equal(await migrateDatabase(db), 6);
  assert.equal(await migrateDatabase(db), 6);
  const first = await createSession(db, {
    issuer: "https://identity.example.com",
    subject: "alice",
    displayName: "Alice",
  });
  const second = await createSession(db, {
    issuer: "https://identity.example.com",
    subject: "bob",
    displayName: "Bob",
  });
  const tenantA = await createTenant(db, first.user, "Workspace A");
  const tenantB = await createTenant(db, second.user, "Workspace B");
  const projectA = await createProject(db, first.user, tenantA.id, {
    name: "Shared business name",
    sourceUrl: "https://example.com",
  });
  const projectB = await createProject(db, second.user, tenantB.id, {
    name: "Shared business name",
  });

  await t.test(
    "sessions retain only hashes, expire and revoke; migrations restrict the request role",
    async () => {
      assert.deepEqual(await sessionActor(db, first.token), first.user);
      assert.equal(await sessionActor(db, "invalid-token"), null);
      await db.transaction(async (client) => {
        const role = await client.query<{
          rolsuper: boolean;
          rolbypassrls: boolean;
        }>(
          "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='everonn_platform_app'",
        );
        assert.equal(role.rows[0].rolsuper, false);
        assert.equal(role.rows[0].rolbypassrls, false);
        const sessions = await client.query<{ token_hash: string }>(
          "SELECT token_hash FROM everonn_platform.sessions",
        );
        assert.ok(
          sessions.rows.some(
            (row) => row.token_hash === sessionHash(first.token),
          ),
        );
        assert.ok(sessions.rows.every((row) => row.token_hash !== first.token));
      });
      const temporary = await createSession(db, {
        issuer: "https://identity.example.com",
        subject: "temporary",
        displayName: "Temporary",
      });
      await revokeSession(db, temporary.token);
      assert.equal(await sessionActor(db, temporary.token), null);
      const expired = await createSession(db, {
        issuer: "https://identity.example.com",
        subject: "expired",
        displayName: "Expired",
      });
      await db.transaction((client) =>
        client.query(
          "UPDATE everonn_platform.sessions SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE token_hash=$1",
          [sessionHash(expired.token)],
        ),
      );
      assert.equal(await sessionActor(db, expired.token), null);
    },
  );
  await t.test(
    "two tenants and repeated business names remain separate, with three stable alternatives",
    async () => {
      assert.notEqual(projectA.id, projectB.id);
      assert.notEqual(projectA.slug, projectB.slug);
      assert.deepEqual(
        (await listProjects(db, first.user)).map((project) => project.id),
        [projectA.id],
      );
      assert.deepEqual(
        (await listProjects(db, second.user)).map((project) => project.id),
        [projectB.id],
      );
      await assert.rejects(
        projectDetail(db, first.user, projectB.id),
        /do not have access/,
      );
      await assert.rejects(
        createProject(db, first.user, tenantB.id, { name: "Unauthorized" }),
        /do not have access/,
      );
      const detail = await projectDetail(db, first.user, projectA.id);
      assert.deepEqual(
        detail.alternatives.map((item) => item.slot),
        [1, 2, 3],
      );
      assert.deepEqual(
        (await projectDetail(db, first.user, projectA.id)).alternatives,
        detail.alternatives,
      );
    },
  );
  await t.test(
    "same-tenant grants apply per project and a viewer cannot upload",
    async () => {
      const viewer = await createSession(db, {
        issuer: "https://identity.example.com",
        subject: "viewer",
        displayName: "Viewer",
      });
      const another = await createProject(db, first.user, tenantA.id, {
        name: "Owner only",
      });
      await db.transaction(async (client) => {
        await client.query(
          "INSERT INTO everonn_platform.tenant_memberships (id,tenant_id,user_id,role) VALUES ($1,$2,$3,'member')",
          [randomUUID(), tenantA.id, viewer.user.id],
        );
        await client.query(
          "INSERT INTO everonn_platform.project_memberships (id,tenant_id,project_id,user_id,permissions) VALUES ($1,$2,$3,$4,ARRAY['view'])",
          [randomUUID(), tenantA.id, projectA.id, viewer.user.id],
        );
      });
      assert.equal(
        (await projectDetail(db, viewer.user, projectA.id)).project.canEdit,
        false,
      );
      await assert.rejects(
        projectDetail(db, viewer.user, another.id),
        /do not have access/,
      );
      await assert.rejects(
        saveArtifact(
          db,
          store,
          viewer.user,
          projectA.id,
          Buffer.from("forbidden"),
          { filename: "x.txt", kind: "document", mediaType: "text/plain" },
        ),
        /do not have access/,
      );
      await db.transaction((client) =>
        client.query(
          "UPDATE everonn_platform.tenant_memberships SET status='revoked' WHERE tenant_id=$1 AND user_id=$2",
          [tenantA.id, viewer.user.id],
        ),
      );
      await assert.rejects(
        projectDetail(db, viewer.user, projectA.id),
        /do not have access/,
      );
    },
  );
  await t.test(
    "job metadata cannot cross projects through a composite foreign key",
    async () => {
      const runId = randomUUID();
      await projectTransaction(
        db,
        first.user,
        projectA.id,
        true,
        (client, project) =>
          client.query(
            "INSERT INTO everonn_platform.pipeline_runs (id,tenant_id,project_id,requested_by) VALUES ($1,$2,$3,$4)",
            [runId, project.tenantId, project.id, first.user.id],
          ),
      );
      await projectTransaction(
        db,
        first.user,
        projectA.id,
        true,
        (client, project) =>
          client.query(
            "INSERT INTO everonn_platform.jobs (id,tenant_id,project_id,pipeline_run_id,stage,target_key,input_sha256,idempotency_key) VALUES ($1,$2,$3,$4,'discover','root',$5,'job-one')",
            [
              randomUUID(),
              project.tenantId,
              project.id,
              runId,
              digest(Buffer.from("input")),
            ],
          ),
      );
      assert.equal(
        (await projectDetail(db, first.user, projectA.id)).jobs.length,
        1,
      );
      assert.equal(
        (await projectDetail(db, second.user, projectB.id)).jobs.length,
        0,
      );
      await assert.rejects(
        projectTransaction(
          db,
          second.user,
          projectB.id,
          true,
          (client, project) =>
            client.query(
              "INSERT INTO everonn_platform.jobs (id,tenant_id,project_id,pipeline_run_id,stage,target_key,input_sha256,idempotency_key) VALUES ($1,$2,$3,$4,'discover','root',$5,'bad-reference')",
              [
                randomUUID(),
                project.tenantId,
                project.id,
                runId,
                digest(Buffer.from("input")),
              ],
            ),
        ),
        (error: unknown) => (error as { code?: string }).code === "23503",
      );
    },
  );
  await t.test(
    "artifact uploads verify checksums, stay private and reject overwrite/tampering",
    async () => {
      const bytes = Buffer.from("<script>private source evidence</script>");
      const saved = await saveArtifact(
        db,
        store,
        first.user,
        projectA.id,
        bytes,
        { filename: "source.html", kind: "document", mediaType: "text/html" },
      );
      assert.equal(saved.sha256, digest(bytes));
      assert.deepEqual(
        Buffer.from(
          (await loadArtifact(db, store, first.user, projectA.id, saved.id))
            .bytes,
        ),
        bytes,
      );
      await assert.rejects(
        loadArtifact(db, store, second.user, projectA.id, saved.id),
        /do not have access/,
      );
      await assert.rejects(
        store.put(saved.key, bytes),
        (error: unknown) => (error as { code?: string }).code === "EEXIST",
      );
      await assert.rejects(store.get("../../private", 0), /Invalid artifact/);
      await assert.rejects(
        projectTransaction(db, first.user, projectA.id, true, (client) =>
          client.query(
            "UPDATE everonn_platform.storage_objects SET sha256=$1 WHERE id=$2",
            [digest(Buffer.from("new")), saved.id],
          ),
        ),
        (error: unknown) => (error as { code?: string }).code === "42501",
      );
      await writeFile(
        path.join(directory, "objects", ...saved.key.split("/")),
        Buffer.alloc(bytes.byteLength, 120),
      );
      await assert.rejects(
        loadArtifact(db, store, first.user, projectA.id, saved.id),
        /integrity verification/,
      );
    },
  );
  await t.test(
    "request boundaries reject forged identity, cross-origin writes and cross-tenant downloads",
    async () => {
      const dependencies = { database: db, store };
      const req = (route: string, token?: string, init?: RequestInit) =>
        new Request("http://localhost:3000/api/platform/" + route, {
          ...init,
          headers: {
            origin: "http://localhost:3000",
            ...(token ? { cookie: "everonn-session=" + token } : {}),
            ...init?.headers,
          },
        });
      assert.equal(
        (
          await platformRequest(
            req("projects", undefined, {
              headers: { "x-user-id": first.user.id },
            }),
            ["projects"],
            dependencies,
          )
        ).status,
        401,
      );
      assert.equal(
        (
          await platformRequest(
            req("tenants", first.token, {
              method: "POST",
              headers: { origin: "https://attacker.example.com" },
              body: '{"name":"Cross origin"}',
            }),
            ["tenants"],
            dependencies,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await platformRequest(
            req("projects/" + projectB.id, first.token),
            ["projects", projectB.id],
            dependencies,
          )
        ).status,
        404,
      );
      const uploaded = await platformRequest(
        req("projects/" + projectA.id + "/artifacts", first.token, {
          method: "POST",
          headers: {
            "content-type": "text/html",
            "x-file-name": "download.html",
          },
          body: "<h1>Private</h1>",
        }),
        ["projects", projectA.id, "artifacts"],
        dependencies,
      );
      assert.equal(uploaded.status, 201);
      const { artifact } = await uploaded.json();
      const downloaded = await platformRequest(
        req(
          "projects/" + projectA.id + "/artifacts/" + artifact.id,
          first.token,
        ),
        ["projects", projectA.id, "artifacts", artifact.id],
        dependencies,
      );
      assert.equal(downloaded.status, 200);
      assert.equal(
        downloaded.headers.get("content-type"),
        "application/octet-stream",
      );
      assert.match(
        downloaded.headers.get("content-disposition")!,
        /^attachment;/,
      );
      assert.equal(
        (
          await platformRequest(
            req(
              "projects/" + projectA.id + "/artifacts/" + artifact.id,
              second.token,
            ),
            ["projects", projectA.id, "artifacts", artifact.id],
            dependencies,
          )
        ).status,
        404,
      );
      Object.assign(process.env, {
        NODE_ENV: "production",
        AUTH_BASE_URL: "https://workspace.example.com",
      });
      assert.equal(
        (
          await platformRequest(
            new Request(
              "https://workspace.example.com/api/platform/auth/development",
              {
                method: "POST",
                headers: { origin: "https://workspace.example.com" },
              },
            ),
            ["auth", "development"],
            dependencies,
          )
        ).status,
        404,
      );
      Object.assign(process.env, {
        NODE_ENV: "test",
        AUTH_BASE_URL: "http://localhost:3000",
      });
    },
  );
  await t.test(
    "OIDC transient state is authenticated, expiring and not readable as plaintext",
    () => {
      const flow = {
        state: "s".repeat(32),
        nonce: "n".repeat(32),
        verifier: "v".repeat(43),
        expiresAt: Date.now() + 60000,
      };
      const encoded = encodeFlow(flow);
      assert.deepEqual(decodeFlow(encoded), flow);
      assert.ok(
        !Buffer.from(encoded, "base64url").includes(Buffer.from(flow.verifier)),
      );
      const changed = Buffer.from(encoded, "base64url");
      changed[changed.length - 1] ^= 1;
      assert.throws(() => decodeFlow(changed.toString("base64url")), /expired/);
      assert.throws(
        () => decodeFlow(encodeFlow({ ...flow, expiresAt: Date.now() - 1000 })),
        /expired/,
      );
    },
  );
  await t.test(
    "OIDC validates token signatures, issuer, audience, nonce and callback state",
    async () => {
      const issuer = "https://identity.example.com";
      const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const wrongKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const flow = {
        state: "s".repeat(32),
        nonce: "n".repeat(32),
        verifier: "v".repeat(43),
        expiresAt: Date.now() + 60000,
      };
      const callback = new Request(
        `http://localhost:3000/api/platform/auth/callback?code=fixture-code&state=${flow.state}`,
      );
      const claims = {
        iss: issuer,
        sub: "verified-subject",
        aud: "test-client",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
        nonce: flow.nonce,
        name: "Verified member",
      };
      function config(overrides: Record<string, unknown> = {}, forged = false) {
        const configuration = new oidc.Configuration(
          {
            issuer,
            authorization_endpoint: issuer + "/authorize",
            token_endpoint: issuer + "/token",
            jwks_uri: issuer + "/jwks",
            id_token_signing_alg_values_supported: ["RS256"],
          },
          "test-client",
          "fixture-secret",
        );
        configuration[oidc.customFetch] = async (input, init) => {
          if (String(input).endsWith("/jwks"))
            return Response.json({
              keys: [
                {
                  ...keys.publicKey.export({ format: "jwk" }),
                  kid: "test-key",
                  use: "sig",
                  alg: "RS256",
                },
              ],
            });
          assert.equal(
            new URLSearchParams(String(init?.body)).get("code_verifier"),
            flow.verifier,
          );
          const data =
            Buffer.from(
              JSON.stringify({ alg: "RS256", kid: "test-key" }),
            ).toString("base64url") +
            "." +
            Buffer.from(JSON.stringify({ ...claims, ...overrides })).toString(
              "base64url",
            );
          const idToken =
            data +
            "." +
            sign(
              "RSA-SHA256",
              Buffer.from(data),
              forged ? wrongKey.privateKey : keys.privateKey,
            ).toString("base64url");
          return Response.json({
            access_token: "fixture-access-token",
            token_type: "Bearer",
            id_token: idToken,
          });
        };
        return configuration;
      }
      const identity = await finishOidcLogin(
        callback,
        encodeFlow(flow),
        config(),
      );
      assert.equal(identity.subject, claims.sub);
      await assert.rejects(
        finishOidcLogin(callback, encodeFlow(flow), config({}, true)),
      );
      await assert.rejects(
        finishOidcLogin(
          callback,
          encodeFlow(flow),
          config({ iss: "https://other.example.com" }),
        ),
      );
      await assert.rejects(
        finishOidcLogin(
          callback,
          encodeFlow(flow),
          config({ aud: "wrong-client" }),
        ),
      );
      await assert.rejects(
        finishOidcLogin(
          callback,
          encodeFlow(flow),
          config({ nonce: "wrong-nonce" }),
        ),
      );
      await assert.rejects(
        finishOidcLogin(
          new Request(
            "http://localhost:3000/api/platform/auth/callback?code=fixture-code&state=wrong",
          ),
          encodeFlow(flow),
          config(),
        ),
      );
    },
  );
  await t.test(
    "S3 writes request conditional creation and failed byte verification does not register an object",
    async () => {
      const data = Buffer.from("immutable artifact");
      let input: Record<string, unknown> | undefined;
      const client = {
        send: async (command: { input: Record<string, unknown> }) => {
          input = command.input;
          return {};
        },
      } as unknown as S3Client;
      const s3 = new S3ObjectStore(client, "private-bucket");
      const key = `tenants/${tenantA.id}/projects/${projectA.id}/objects/${randomUUID()}/${digest(data)}`;
      await s3.put(key, data);
      assert.equal(input?.IfNoneMatch, "*");
      assert.equal(input?.ContentType, "application/octet-stream");
      const before = (await projectDetail(db, first.user, projectA.id))
        .artifacts.length;
      await assert.rejects(
        saveArtifact(
          db,
          { put: async () => {}, get: async () => Buffer.from("wrong bytes") },
          first.user,
          projectA.id,
          data,
          {
            filename: "unverified.txt",
            kind: "document",
            mediaType: "text/plain",
          },
        ),
        /integrity verification/,
      );
      assert.equal(
        (await projectDetail(db, first.user, projectA.id)).artifacts.length,
        before,
      );
    },
  );
  await t.test(
    "role and actor settings do not survive a transaction",
    async () => {
      await actorTransaction(db, first.user.id, (client) =>
        client.query("SELECT current_user"),
      );
      await db.transaction(async (client) => {
        const scope = await client.query<{
          actor: string | null;
          role: string;
        }>(
          "SELECT current_user AS role,current_setting('everonn.actor_id',true) AS actor",
        );
        assert.notEqual(scope.rows[0].role, "everonn_platform_app");
        assert.ok(!scope.rows[0].actor);
        await client.exec("SET LOCAL ROLE everonn_platform_app");
        assert.equal(
          (await client.query("SELECT id FROM everonn_platform.projects")).rows
            .length,
          0,
        );
      });
    },
  );
});

test("local SQL and private objects persist across database restart", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "everonn-platform-test-"),
  );
  let db: PlatformDatabase | undefined;
  try {
    db = await embeddedDatabase(path.join(directory, "database"));
    await migrateDatabase(db);
    const session = await createSession(db, {
      issuer: "https://identity.example.com",
      subject: "persisted",
      displayName: "Persisted user",
    });
    const tenant = await createTenant(db, session.user, "Persistent workspace");
    const project = await createProject(db, session.user, tenant.id, {
      name: "Persistent project",
    });
    await db.close();
    db = undefined;
    db = await embeddedDatabase(path.join(directory, "database"));
    await migrateDatabase(db);
    assert.equal((await sessionActor(db, session.token))?.id, session.user.id);
    assert.equal(
      (await projectDetail(db, session.user, project.id)).alternatives.length,
      3,
    );
  } finally {
    await db?.close();
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith("everonn-platform-test-"));
    await rm(resolved, { recursive: true, force: true });
  }
});
