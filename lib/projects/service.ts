import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Actor } from "../auth/sessions";
import {
  actorTransaction,
  type PlatformDatabase,
  type SqlClient,
} from "../platform/database";
import { PlatformError } from "../platform/config";
import { parsePublicUrl } from "../network";

export type Tenant = { id: string; name: string; role: string };
export type Project = {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  sourceUrl: string | null;
  createdAt: string;
  canEdit: boolean;
  canReview: boolean;
};
export type ArtifactRecord = {
  id: string;
  key: string;
  filename: string;
  kind: string;
  sha256: string;
  byteSize: number;
  mediaType: string;
  createdAt: string;
};
export const uuid = z.uuid();
const nameSchema = z.string().trim().min(1).max(120);
export const projectInput = z
  .object({
    name: nameSchema,
    sourceUrl: z.string().trim().max(2048).default(""),
  })
  .strict();
export const tenantInput = z.object({ name: nameSchema }).strict();
const projectColumns = `p.id,p.tenant_id AS "tenantId",p.name,p.slug,p.source_url AS "sourceUrl",p.created_at::text AS "createdAt",everonn_platform.project_permission(p.tenant_id,p.id,'edit') AS "canEdit",everonn_platform.project_permission(p.tenant_id,p.id,'review') AS "canReview"`;

export async function listTenants(db: PlatformDatabase, actor: Actor) {
  return actorTransaction(
    db,
    actor.id,
    async (client) =>
      (
        await client.query<Tenant>(
          `SELECT t.id,t.name,m.role FROM everonn_platform.tenants t JOIN everonn_platform.tenant_memberships m ON m.tenant_id=t.id WHERE m.user_id=$1 AND m.status='active' ORDER BY t.created_at,t.id`,
          [actor.id],
        )
      ).rows,
  );
}
export async function createTenant(
  db: PlatformDatabase,
  actor: Actor,
  name: string,
) {
  name = nameSchema.parse(name);
  return actorTransaction(db, actor.id, async (client) => {
    const id = randomUUID();
    await client.query(
      "SELECT set_config('everonn.bootstrap_tenant',$1,true)",
      [id],
    );
    await client.query(
      "INSERT INTO everonn_platform.tenants (id,name,created_by) VALUES ($1,$2,$3)",
      [id, name, actor.id],
    );
    await client.query(
      "INSERT INTO everonn_platform.tenant_memberships (id,tenant_id,user_id,role) VALUES ($1,$2,$3,'owner')",
      [randomUUID(), id, actor.id],
    );
    await audit(client, actor, id, null, "tenant.created", id);
    return { id, name, role: "owner" };
  });
}
export async function listProjects(db: PlatformDatabase, actor: Actor) {
  return actorTransaction(
    db,
    actor.id,
    async (client) =>
      (
        await client.query<Project>(
          `SELECT ${projectColumns} FROM everonn_platform.projects p JOIN everonn_platform.tenants t ON t.id=p.tenant_id WHERE p.status='active' ORDER BY p.created_at,p.id`,
        )
      ).rows,
  );
}

export async function scopedProject(
  client: SqlClient,
  id: string,
  edit = false,
) {
  uuid.parse(id);
  const result = await client.query<Project>(
    `SELECT ${projectColumns} FROM everonn_platform.projects p JOIN everonn_platform.tenants t ON t.id=p.tenant_id WHERE p.id=$1 AND p.status='active'`,
    [id],
  );
  const project = result.rows[0];
  if (!project || (edit && !project.canEdit))
    throw new PlatformError(
      "This project is unavailable or you do not have access.",
      404,
    );
  await client.query(
    "SELECT set_config('everonn.tenant_id',$1,true),set_config('everonn.project_id',$2,true)",
    [project.tenantId, project.id],
  );
  return project;
}
export async function projectTransaction<T>(
  db: PlatformDatabase,
  actor: Actor,
  id: string,
  edit: boolean,
  work: (client: SqlClient, project: Project) => Promise<T>,
) {
  return actorTransaction(db, actor.id, async (client) =>
    work(client, await scopedProject(client, id, edit)),
  );
}
export async function createProject(
  db: PlatformDatabase,
  actor: Actor,
  tenantId: string,
  input: z.input<typeof projectInput>,
) {
  uuid.parse(tenantId);
  const data = projectInput.parse(input);
  let sourceUrl: string | null = null;
  if (data.sourceUrl) {
    try {
      sourceUrl = parsePublicUrl(data.sourceUrl).href;
    } catch {
      throw new PlatformError("Use a public HTTP or HTTPS website URL.");
    }
  }
  return actorTransaction(db, actor.id, async (client) => {
    const permission = await client.query<{ allowed: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM everonn_platform.tenants WHERE id=$1 AND everonn_platform.tenant_permission(id,true)) AS allowed",
      [tenantId],
    );
    if (!permission.rows[0].allowed)
      throw new PlatformError(
        "This workspace is unavailable or you do not have access.",
        404,
      );
    const id = randomUUID();
    const slug =
      (data.name
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 70) || "project") +
      "-" +
      id.slice(0, 8);
    await client.query(
      "INSERT INTO everonn_platform.projects (id,tenant_id,name,slug,source_url,created_by) VALUES ($1,$2,$3,$4,$5,$6)",
      [id, tenantId, data.name, slug, sourceUrl, actor.id],
    );
    const project = await scopedProject(client, id, true);
    for (const slot of [1, 2, 3])
      await client.query(
        "INSERT INTO everonn_platform.design_alternatives (id,tenant_id,project_id,slot,name) VALUES ($1,$2,$3,$4,$5)",
        [randomUUID(), tenantId, id, slot, `Alternative ${slot}`],
      );
    await audit(client, actor, tenantId, id, "project.created", id);
    return project;
  });
}
export async function projectDetail(
  db: PlatformDatabase,
  actor: Actor,
  id: string,
) {
  return projectTransaction(db, actor, id, false, async (client, project) => ({
    project,
    alternatives: (
      await client.query<{ id: string; slot: number; name: string }>(
        "SELECT id,slot,name FROM everonn_platform.design_alternatives WHERE project_id=$1 ORDER BY slot",
        [id],
      )
    ).rows,
    artifacts: (
      await client.query<ArtifactRecord>(
        'SELECT id,key,filename,kind,sha256,byte_size::int AS "byteSize",media_type AS "mediaType",created_at::text AS "createdAt" FROM everonn_platform.storage_objects WHERE project_id=$1 AND kind=\'document\' ORDER BY created_at DESC,id',
        [id],
      )
    ).rows,
    jobs: (
      await client.query(
        "SELECT id,stage,target_key,state,reason FROM everonn_platform.jobs WHERE project_id=$1 ORDER BY created_at DESC LIMIT 100",
        [id],
      )
    ).rows,
  }));
}
export async function audit(
  client: SqlClient,
  actor: Actor,
  tenantId: string,
  projectId: string | null,
  action: string,
  subjectId: string,
) {
  await client.query(
    "INSERT INTO everonn_platform.audit_events (id,tenant_id,project_id,actor_id,action,subject_id) VALUES ($1,$2,$3,$4,$5,$6)",
    [randomUUID(), tenantId, projectId, actor.id, action, subjectId],
  );
}
