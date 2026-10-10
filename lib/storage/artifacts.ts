import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { z } from "zod";
import type { Actor } from "../auth/sessions";
import type { PlatformDatabase, SqlClient } from "../platform/database";
import { localPlatformMode, PlatformError } from "../platform/config";
import {
  audit,
  projectTransaction,
  uuid,
  type ArtifactRecord,
  type Project,
} from "../projects/service";

export const artifactLimit = 64_000_000;
export const digest = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
export interface ObjectStore {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string, expectedSize: number): Promise<Uint8Array>;
}
function validateKey(key: string) {
  if (
    !/^tenants\/[a-f0-9-]{36}\/projects\/[a-f0-9-]{36}\/objects\/[a-f0-9-]{36}\/[a-f0-9]{64}$/.test(
      key,
    )
  )
    throw new PlatformError("Invalid artifact identity.");
}
export class LocalObjectStore implements ObjectStore {
  constructor(private root: string) {
    this.root = path.resolve(root);
  }
  private file(key: string) {
    validateKey(key);
    const file = path.resolve(this.root, ...key.split("/"));
    if (!file.startsWith(this.root + path.sep))
      throw new PlatformError("Invalid artifact identity.");
    return file;
  }
  async put(key: string, bytes: Uint8Array) {
    if (bytes.byteLength > artifactLimit)
      throw new PlatformError("Artifact exceeds the 64 MB limit.", 413);
    const file = this.file(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes, { flag: "wx", mode: 0o600 });
  }
  async get(key: string, expectedSize: number) {
    const file = this.file(key);
    const metadata = await stat(file);
    if (metadata.size !== expectedSize || metadata.size > artifactLimit)
      throw new PlatformError(
        "The stored artifact failed integrity verification.",
        503,
      );
    return readFile(file);
  }
}
export class S3ObjectStore implements ObjectStore {
  constructor(
    private client: S3Client,
    private bucket: string,
  ) {}
  async put(key: string, bytes: Uint8Array) {
    validateKey(key);
    if (bytes.byteLength > artifactLimit)
      throw new PlatformError("Artifact exceeds the 64 MB limit.", 413);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        IfNoneMatch: "*",
        ChecksumSHA256: createHash("sha256").update(bytes).digest("base64"),
        ContentType: "application/octet-stream",
      }),
    );
  }
  async get(key: string, expectedSize: number) {
    validateKey(key);
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (
      !result.Body ||
      result.ContentLength !== expectedSize ||
      expectedSize > artifactLimit
    )
      throw new PlatformError(
        "The stored artifact failed integrity verification.",
        503,
      );
    const parts: Uint8Array[] = [];
    let size = 0;
    for await (const part of result.Body as AsyncIterable<Uint8Array>) {
      size += part.byteLength;
      if (size > expectedSize)
        throw new PlatformError(
          "The stored artifact failed integrity verification.",
          503,
        );
      parts.push(part);
    }
    if (size !== expectedSize)
      throw new PlatformError(
        "The stored artifact failed integrity verification.",
        503,
      );
    return Buffer.concat(parts);
  }
}
export function getObjectStore(): ObjectStore {
  if (localPlatformMode())
    return new LocalObjectStore(
      process.env.PLATFORM_OBJECTS_DIR || "data/platform/objects",
    );
  const bucket = process.env.OBJECT_STORAGE_BUCKET?.trim();
  const region = process.env.OBJECT_STORAGE_REGION?.trim();
  const endpoint = process.env.OBJECT_STORAGE_ENDPOINT?.trim();
  if (!bucket || !region)
    throw new PlatformError("Private artifact storage is not configured.", 503);
  if (endpoint && new URL(endpoint).protocol !== "https:")
    throw new PlatformError("Object storage requires HTTPS.", 503);
  const accessKeyId = process.env.OBJECT_STORAGE_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY?.trim();
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey))
    throw new PlatformError("Object storage credentials are incomplete.", 503);
  return new S3ObjectStore(
    new S3Client({
      region,
      endpoint,
      forcePathStyle: Boolean(endpoint),
      ...(accessKeyId && secretAccessKey
        ? { credentials: { accessKeyId, secretAccessKey } }
        : {}),
    }),
    bucket,
  );
}
const uploadSchema = z.object({
  filename: z.string().trim().min(1).max(200),
  kind: z.enum(["document", "source", "asset"]),
  mediaType: z.string().min(1).max(150),
});
export type PreparedObject = Omit<ArtifactRecord, "createdAt">;
// Upload first, register within the caller's SQL transaction after its lease check.
export async function prepareObject(
  store: ObjectStore,
  project: Project,
  bytes: Uint8Array,
  filename: string,
  mediaType = "application/json",
): Promise<PreparedObject> {
  if (bytes.byteLength > artifactLimit)
    throw new PlatformError("Artifact exceeds the 64 MB limit.", 413);
  const id = randomUUID(),
    sha256 = digest(bytes);
  const key = `tenants/${project.tenantId}/projects/${project.id}/objects/${id}/${sha256}`;
  await store.put(key, bytes);
  if (digest(await store.get(key, bytes.byteLength)) !== sha256)
    throw new PlatformError(
      "The stored artifact failed integrity verification.",
      503,
    );
  return {
    id,
    key,
    sha256,
    filename,
    mediaType,
    kind: "source",
    byteSize: bytes.byteLength,
  };
}
export async function registerObject(
  client: SqlClient,
  actor: Actor,
  project: Project,
  object: PreparedObject,
) {
  await client.query(
    `INSERT INTO everonn_platform.storage_objects (id,tenant_id,project_id,key,kind,sha256,byte_size,media_type,filename,created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      object.id,
      project.tenantId,
      project.id,
      object.key,
      object.kind,
      object.sha256,
      object.byteSize,
      object.mediaType,
      object.filename,
      actor.id,
    ],
  );
}
export async function saveArtifact(
  db: PlatformDatabase,
  store: ObjectStore,
  actor: Actor,
  projectId: string,
  bytes: Uint8Array,
  input: z.infer<typeof uploadSchema>,
) {
  const data = uploadSchema.parse(input);
  if (bytes.byteLength > artifactLimit)
    throw new PlatformError("Artifact exceeds the 64 MB limit.", 413);
  const project = await projectTransaction(
    db,
    actor,
    projectId,
    true,
    async (_, project) => project,
  );
  const id = randomUUID();
  const sha256 = digest(bytes);
  const key = `tenants/${project.tenantId}/projects/${project.id}/objects/${id}/${sha256}`;
  await store.put(key, bytes);
  // Verify actual bytes before registering; storage and SQL do not share a transaction.
  if (digest(await store.get(key, bytes.byteLength)) !== sha256)
    throw new PlatformError(
      "The stored artifact failed integrity verification.",
      503,
    );
  return projectTransaction(
    db,
    actor,
    projectId,
    true,
    async (client, current) => {
      const filename = data.filename.replace(/[^\p{L}\p{N} ._-]/gu, "_");
      const result = await client.query<ArtifactRecord>(
        `INSERT INTO everonn_platform.storage_objects (id,tenant_id,project_id,key,kind,sha256,byte_size,media_type,filename,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,key,filename,kind,sha256,byte_size::int AS "byteSize",media_type AS "mediaType",created_at::text AS "createdAt"`,
        [
          id,
          current.tenantId,
          current.id,
          key,
          data.kind,
          sha256,
          bytes.byteLength,
          data.mediaType,
          filename,
          actor.id,
        ],
      );
      await audit(
        client,
        actor,
        current.tenantId,
        current.id,
        "artifact.created",
        id,
      );
      return result.rows[0];
    },
  );
}
export async function loadArtifact(
  db: PlatformDatabase,
  store: ObjectStore,
  actor: Actor,
  projectId: string,
  artifactId: string,
) {
  uuid.parse(artifactId);
  const record = await projectTransaction(
    db,
    actor,
    projectId,
    false,
    async (client) => {
      const result = await client.query<ArtifactRecord>(
        'SELECT id,key,filename,kind,sha256,byte_size::int AS "byteSize",media_type AS "mediaType",created_at::text AS "createdAt" FROM everonn_platform.storage_objects WHERE id=$1 AND project_id=$2',
        [artifactId, projectId],
      );
      if (!result.rows[0])
        throw new PlatformError(
          "This artifact is unavailable or you do not have access.",
          404,
        );
      return result.rows[0];
    },
  );
  const bytes = await store.get(record.key, record.byteSize);
  if (digest(bytes) !== record.sha256)
    throw new PlatformError(
      "The stored artifact failed integrity verification.",
      503,
    );
  return { record, bytes };
}
