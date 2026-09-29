import { getStore, type Store } from "@netlify/blobs";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export type GoogleConnection = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string[];
  tokenType: string;
  connectedAt: string;
};

type EncryptedPayload = { version: 1; iv: string; tag: string; ciphertext: string };
type ProviderStore = { version: 1; google: Record<string, EncryptedPayload> };
type OAuthState = { workspaceId: string; nonce: string; returnTo: string; expiresAt: number };

const defaultConnectionsFile = path.join(process.cwd(), "data", "provider-connections.json");
const connectionsFile = path.resolve(/*turbopackIgnore: true*/ process.env.EVERONN_CONNECTIONS_FILE || defaultConnectionsFile);
const connectionsBlobKey = "provider-connections-v1";
let writeQueue: Promise<unknown> = Promise.resolve();

function usesNetlifyBlobs() {
  return process.env.NETLIFY === "true" || Boolean(process.env.NETLIFY_BLOBS_CONTEXT);
}

function connectionsBlobStore(): Store {
  return getStore({ name: "everonn-provider-connections", consistency: "strong" });
}

function encryptionKey(secret: string) {
  if (secret.trim().length < 32) throw new Error("CREDENTIAL_ENCRYPTION_KEY must contain at least 32 characters.");
  return createHash("sha256").update(secret).digest();
}

export function encryptProviderPayload<T>(value: T, secret: string): EncryptedPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return { version: 1, iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), ciphertext: ciphertext.toString("base64url") };
}

export function decryptProviderPayload<T>(payload: EncryptedPayload, secret: string): T {
  if (payload.version !== 1) throw new Error("Unsupported provider credential version.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), Buffer.from(payload.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64url"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, "base64url")), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}

function credentialSecret() {
  return String(process.env.CREDENTIAL_ENCRYPTION_KEY || "").trim();
}

function validStore(value: unknown): value is ProviderStore {
  const store = value as Partial<ProviderStore> | null;
  return Boolean(store && store.version === 1 && store.google && typeof store.google === "object");
}

async function readFileStore(): Promise<ProviderStore> {
  try {
    const parsed = JSON.parse(await readFile(/*turbopackIgnore: true*/ connectionsFile, "utf8")) as ProviderStore;
    if (!validStore(parsed)) throw new Error("Invalid provider connection store.");
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, google: {} };
    throw error;
  }
}

async function readBlobStore() {
  const entry = await connectionsBlobStore().getWithMetadata(connectionsBlobKey, { type: "json", consistency: "strong" });
  if (!entry) return { store: { version: 1, google: {} } satisfies ProviderStore, etag: undefined };
  if (!validStore(entry.data)) throw new Error("Invalid provider connection store.");
  return { store: structuredClone(entry.data), etag: entry.etag };
}

async function readStore(): Promise<ProviderStore> {
  await writeQueue.catch(() => undefined);
  return usesNetlifyBlobs() ? (await readBlobStore()).store : readFileStore();
}

async function writeStore(store: ProviderStore) {
  await mkdir(path.dirname(connectionsFile), { recursive: true });
  const temporaryFile = `${connectionsFile}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  try {
    await rename(temporaryFile, connectionsFile);
  } catch {
    await copyFile(temporaryFile, connectionsFile);
    await unlink(temporaryFile).catch(() => undefined);
  }
}

function mutateStore(update: (store: ProviderStore) => void) {
  const operation = writeQueue.then(async () => {
    if (usesNetlifyBlobs()) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const current = await readBlobStore();
        update(current.store);
        const result = current.etag
          ? await connectionsBlobStore().setJSON(connectionsBlobKey, current.store, { onlyIfMatch: current.etag })
          : await connectionsBlobStore().setJSON(connectionsBlobKey, current.store, { onlyIfNew: true });
        if (result.modified) return;
      }
      throw new Error("Provider connections changed repeatedly while saving. Please retry.");
    }
    let store: ProviderStore;
    try {
      const parsed = JSON.parse(await readFile(/*turbopackIgnore: true*/ connectionsFile, "utf8")) as ProviderStore;
      store = validStore(parsed) ? parsed : { version: 1, google: {} };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      store = { version: 1, google: {} };
    }
    update(store);
    await writeStore(store);
  });
  writeQueue = operation.catch(() => undefined);
  return operation;
}

export async function getGoogleConnection(workspaceId: string) {
  const encrypted = (await readStore()).google[workspaceId];
  return encrypted ? decryptProviderPayload<GoogleConnection>(encrypted, credentialSecret()) : null;
}

export function saveGoogleConnection(workspaceId: string, connection: GoogleConnection) {
  return mutateStore((store) => {
    store.google[workspaceId] = encryptProviderPayload(connection, credentialSecret());
  });
}

export function deleteGoogleConnection(workspaceId: string) {
  return mutateStore((store) => {
    delete store.google[workspaceId];
  });
}

export function signGoogleOAuthState(state: OAuthState, secret: string) {
  const payload = Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
  const signature = createHmac("sha256", encryptionKey(secret)).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyGoogleOAuthState(token: string, secret: string): OAuthState {
  const [payload, suppliedSignature] = token.split(".");
  if (!payload || !suppliedSignature) throw new Error("Invalid Google OAuth state.");
  const expectedSignature = createHmac("sha256", encryptionKey(secret)).update(payload).digest();
  const supplied = Buffer.from(suppliedSignature, "base64url");
  if (supplied.length !== expectedSignature.length || !timingSafeEqual(supplied, expectedSignature)) throw new Error("Invalid Google OAuth state signature.");
  const state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthState;
  if (!state.workspaceId || !state.nonce || state.expiresAt < Date.now()) throw new Error("Google OAuth state expired.");
  return state;
}
