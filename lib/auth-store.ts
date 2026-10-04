import "server-only";
import { getStore, type Store } from "@netlify/blobs";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TeamMember, WorkspaceRole } from "@/features/everonn/types";
import { hashPassword, verifyPassword } from "@/features/auth/password";
import type { AuthActor, AuthInvitationRecord, AuthStore, AuthUserRecord } from "@/features/auth/types";
import { appDatabaseConfigured, appRecords } from "./app-records";

const defaultAuthFile = path.join(process.cwd(), "data", "auth.json");
const authFile = path.resolve(/*turbopackIgnore: true*/ process.env.EVERONN_AUTH_FILE || defaultAuthFile);
const authBlobKey = "auth-v1";
const sessionLifetimeMs = 7 * 24 * 60 * 60_000;
const invitationLifetimeMs = 7 * 24 * 60 * 60_000;
const emptyStore = (): AuthStore => ({ version: 1, users: [], sessions: [], invitations: [] });
let authQueue: Promise<unknown> = Promise.resolve();

function usesNetlifyBlobs() {
  return process.env.NETLIFY === "true" || Boolean(process.env.NETLIFY_BLOBS_CONTEXT);
}

function authBlobStore(): Store {
  return getStore({ name: "everonn-auth", consistency: "strong" });
}

function validStore(value: unknown): value is AuthStore {
  const store = value as Partial<AuthStore> | null;
  return Boolean(store && store.version === 1 && Array.isArray(store.users) && Array.isArray(store.sessions) && Array.isArray(store.invitations));
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("base64url");
}

function actorFor(user: AuthUserRecord): AuthActor {
  return {
    userId: user.userId,
    memberId: user.memberId,
    workspaceId: user.workspaceId,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}

function cleanExpired(store: AuthStore, now = Date.now()) {
  store.sessions = store.sessions.filter((session) => Date.parse(session.expiresAt) > now);
  store.invitations = store.invitations.filter((invitation) => Date.parse(invitation.expiresAt) > now);
}

async function readFileStore() {
  try {
    const parsed = JSON.parse(await readFile(/*turbopackIgnore: true*/ authFile, "utf8")) as unknown;
    if (!validStore(parsed)) throw new Error("Invalid EverOnn authentication store.");
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
    throw error;
  }
}

async function readBlobStore() {
  const entry = await authBlobStore().getWithMetadata(authBlobKey, { type: "json", consistency: "strong" });
  if (!entry) return { store: emptyStore(), etag: undefined as string | undefined };
  if (!validStore(entry.data)) throw new Error("Invalid EverOnn authentication store.");
  return { store: structuredClone(entry.data), etag: entry.etag };
}

async function readStore() {
  await authQueue.catch(() => undefined);
  if (appDatabaseConfigured()) {
    const current = await appRecords().read<AuthStore>("auth/accounts");
    if (!current) return emptyStore();
    if (!validStore(current.data)) throw new Error("Invalid EverOnn authentication store.");
    return current.data;
  }
  return usesNetlifyBlobs() ? (await readBlobStore()).store : readFileStore();
}

async function writeFileStore(store: AuthStore) {
  await mkdir(path.dirname(authFile), { recursive: true });
  const temporaryFile = `${authFile}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  try {
    await rename(temporaryFile, authFile);
  } catch {
    await copyFile(temporaryFile, authFile);
    await unlink(temporaryFile).catch(() => undefined);
  }
}

function mutateStore<T>(update: (store: AuthStore) => T | Promise<T>) {
  const operation = authQueue.then(async () => {
    if (appDatabaseConfigured()) {
      return appRecords().mutate("auth/accounts", emptyStore, assertAuthStore, async (store) => {
        cleanExpired(store);
        return update(store);
      });
    }
    if (usesNetlifyBlobs()) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const current = await readBlobStore();
        cleanExpired(current.store);
        const value = await update(current.store);
        const result = current.etag
          ? await authBlobStore().setJSON(authBlobKey, current.store, { onlyIfMatch: current.etag })
          : await authBlobStore().setJSON(authBlobKey, current.store, { onlyIfNew: true });
        if (result.modified) return value;
      }
      throw new Error("Authentication data changed repeatedly while saving. Please retry.");
    }
    const store = await readFileStore();
    cleanExpired(store);
    const value = await update(store);
    await writeFileStore(store);
    return value;
  });
  authQueue = operation.catch(() => undefined);
  return operation;
}

function assertAuthStore(value: unknown): asserts value is AuthStore {
  if (!validStore(value)) throw new Error("Invalid EverOnn authentication store.");
}

function newSession(store: AuthStore, user: AuthUserRecord) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  store.sessions = store.sessions.filter((session) => session.userId !== user.userId || Date.parse(session.expiresAt) > now.getTime()).slice(-100);
  store.sessions.push({
    tokenHash: tokenHash(token),
    userId: user.userId,
    workspaceId: user.workspaceId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + sessionLifetimeMs).toISOString(),
  });
  const userSessions = store.sessions.filter((session) => session.userId === user.userId);
  if (userSessions.length > 5) {
    const remove = new Set(userSessions.slice(0, userSessions.length - 5).map((session) => session.tokenHash));
    store.sessions = store.sessions.filter((session) => !remove.has(session.tokenHash));
  }
  return { token, actor: actorFor(user) };
}

function validSetupToken(supplied: string) {
  const expected = String(process.env.EVERONN_AUTH_SETUP_TOKEN || "").trim();
  if (!expected) return process.env.NODE_ENV !== "production";
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function getAuthSetupState() {
  const store = await readStore();
  const setupRequired = store.users.length === 0;
  const configuredToken = Boolean(String(process.env.EVERONN_AUTH_SETUP_TOKEN || "").trim());
  return {
    setupRequired,
    setupAllowed: !setupRequired || process.env.NODE_ENV !== "production" || configuredToken,
    setupTokenRequired: setupRequired && configuredToken,
  };
}

export async function initializeOwnerAccount(input: { workspaceId: string; memberId: string; name: string; email: string; password: string; setupToken: string }) {
  const passwordHash = await hashPassword(input.password);
  if (!validSetupToken(input.setupToken)) throw Object.assign(new Error("The owner setup token is invalid."), { status: 403 });
  return mutateStore((store) => {
    if (store.users.length) throw new Error("The owner account has already been configured.");
    const now = new Date().toISOString();
    const user: AuthUserRecord = {
      userId: `user_${crypto.randomUUID()}`,
      memberId: input.memberId,
      workspaceId: input.workspaceId,
      name: input.name.trim().slice(0, 120),
      email: normalizeEmail(input.email).slice(0, 254),
      role: "owner",
      passwordHash,
      status: "active",
      failedLoginCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    store.users.push(user);
    return newSession(store, user);
  });
}

export async function registerWorkspaceOwner(input: { workspaceId: string; memberId: string; name: string; email: string; password: string }) {
  const passwordHash = await hashPassword(input.password);
  const email = normalizeEmail(input.email).slice(0, 254);
  return mutateStore((store) => {
    if (store.users.some((user) => user.email === email)) {
      throw Object.assign(new Error("An account already exists for this email address."), { status: 409 });
    }
    if (store.users.some((user) => user.workspaceId === input.workspaceId)) {
      throw Object.assign(new Error("This workspace account already exists."), { status: 409 });
    }
    const now = new Date().toISOString();
    const user: AuthUserRecord = {
      userId: `user_${crypto.randomUUID()}`,
      memberId: input.memberId,
      workspaceId: input.workspaceId,
      name: input.name.trim().slice(0, 120),
      email,
      role: "owner",
      passwordHash,
      status: "active",
      failedLoginCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    store.users.push(user);
    return newSession(store, user);
  });
}

export async function authenticateCredentials(email: string, password: string) {
  const normalizedEmail = normalizeEmail(email);
  const snapshot = await readStore();
  const snapshotUser = snapshot.users.find((user) => user.email === normalizedEmail && user.status === "active");
  if (!snapshotUser) {
    await hashPassword("EverOnn-Dummy-Password-2026!");
    throw Object.assign(new Error("The email or password is incorrect."), { status: 401 });
  }
  if (snapshotUser.lockedUntil && Date.parse(snapshotUser.lockedUntil) > Date.now()) {
    throw Object.assign(new Error("Too many failed attempts. Try again in 15 minutes."), { status: 429 });
  }
  const verified = await verifyPassword(password, snapshotUser.passwordHash);
  const result = await mutateStore((store) => {
    const user = store.users.find((item) => item.userId === snapshotUser.userId && item.passwordHash === snapshotUser.passwordHash);
    if (!user || user.status !== "active") return { authenticated: false as const, locked: false };
    const now = new Date();
    if (!verified) {
      user.failedLoginCount += 1;
      let locked = false;
      if (user.failedLoginCount >= 5) {
        user.failedLoginCount = 0;
        user.lockedUntil = new Date(now.getTime() + 15 * 60_000).toISOString();
        locked = true;
      }
      user.updatedAt = now.toISOString();
      return { authenticated: false as const, locked };
    }
    user.failedLoginCount = 0;
    delete user.lockedUntil;
    user.updatedAt = now.toISOString();
    return { authenticated: true as const, ...newSession(store, user) };
  });
  if (!result.authenticated) {
    if (result.locked) throw Object.assign(new Error("Too many failed attempts. Try again in 15 minutes."), { status: 429 });
    throw Object.assign(new Error("The email or password is incorrect."), { status: 401 });
  }
  return result;
}

export async function actorForSessionToken(token: string) {
  if (!token) return null;
  const store = await readStore();
  const session = store.sessions.find((item) => item.tokenHash === tokenHash(token) && Date.parse(item.expiresAt) > Date.now());
  if (!session) return null;
  const user = store.users.find((item) => item.userId === session.userId && item.workspaceId === session.workspaceId && item.status === "active");
  return user ? actorFor(user) : null;
}

export function revokeSession(token: string) {
  const hash = tokenHash(token);
  return mutateStore((store) => {
    store.sessions = store.sessions.filter((session) => session.tokenHash !== hash);
  });
}

export function rollbackNewAccount(userId: string) {
  return mutateStore((store) => {
    store.users = store.users.filter((user) => user.userId !== userId);
    store.sessions = store.sessions.filter((session) => session.userId !== userId);
  });
}

export async function replacePassword(actor: AuthActor, currentPassword: string, nextPassword: string) {
  const nextHash = await hashPassword(nextPassword);
  const snapshot = await readStore();
  const snapshotUser = snapshot.users.find((user) => user.userId === actor.userId && user.status === "active");
  if (!snapshotUser || !await verifyPassword(currentPassword, snapshotUser.passwordHash)) throw new Error("The current password is incorrect.");
  return mutateStore((store) => {
    const user = store.users.find((item) => item.userId === actor.userId && item.passwordHash === snapshotUser.passwordHash);
    if (!user) throw new Error("The account changed while updating the password. Please retry.");
    user.passwordHash = nextHash;
    user.updatedAt = new Date().toISOString();
    user.failedLoginCount = 0;
    delete user.lockedUntil;
    store.sessions = store.sessions.filter((session) => session.userId !== user.userId);
    return newSession(store, user);
  });
}

export function createTeamInvitation(input: { actor: AuthActor; memberId: string; name: string; email: string; role: Exclude<WorkspaceRole, "owner"> }) {
  const rawToken = randomBytes(32).toString("base64url");
  const email = normalizeEmail(input.email);
  return mutateStore((store) => {
    if (store.users.some((user) => user.email === email)) throw new Error("An account already exists for this email address.");
    store.invitations = store.invitations.filter((invitation) => invitation.email !== email);
    const now = new Date();
    const invitation: AuthInvitationRecord = {
      tokenHash: tokenHash(rawToken),
      workspaceId: input.actor.workspaceId,
      memberId: input.memberId,
      name: input.name.trim().slice(0, 120),
      email,
      role: input.role,
      createdByUserId: input.actor.userId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + invitationLifetimeMs).toISOString(),
    };
    store.invitations.push(invitation);
    return { token: rawToken, invitation: structuredClone(invitation) };
  });
}

export function cancelTeamInvitation(token: string) {
  const hash = tokenHash(token);
  return mutateStore((store) => {
    store.invitations = store.invitations.filter((invitation) => invitation.tokenHash !== hash);
  });
}

export async function getTeamInvitation(token: string) {
  if (!token) return null;
  const store = await readStore();
  const invitation = store.invitations.find((item) => item.tokenHash === tokenHash(token) && Date.parse(item.expiresAt) > Date.now());
  if (!invitation || store.users.some((user) => user.email === invitation.email)) return null;
  return structuredClone(invitation);
}

export async function acceptTeamInvitation(token: string, password: string) {
  const passwordHash = await hashPassword(password);
  const hash = tokenHash(token);
  return mutateStore((store) => {
    const invitation = store.invitations.find((item) => item.tokenHash === hash && Date.parse(item.expiresAt) > Date.now());
    if (!invitation) throw new Error("This invitation is invalid or has expired.");
    if (store.users.some((user) => user.email === invitation.email)) throw new Error("An account already exists for this email address.");
    const now = new Date().toISOString();
    const user: AuthUserRecord = {
      userId: `user_${crypto.randomUUID()}`,
      memberId: invitation.memberId,
      workspaceId: invitation.workspaceId,
      name: invitation.name,
      email: invitation.email,
      role: invitation.role,
      passwordHash,
      status: "active",
      failedLoginCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    store.users.push(user);
    store.invitations = store.invitations.filter((item) => item.tokenHash !== hash);
    return { ...newSession(store, user), invitation: structuredClone(invitation) };
  });
}

export function rollbackAcceptedTeamInvitation(userId: string, token: string, invitation: AuthInvitationRecord) {
  const hash = tokenHash(token);
  return mutateStore((store) => {
    store.users = store.users.filter((user) => user.userId !== userId);
    store.sessions = store.sessions.filter((session) => session.userId !== userId);
    const emailInUse = store.users.some((user) => user.email === invitation.email);
    const invitationExists = store.invitations.some((item) => item.tokenHash === hash);
    if (!emailInUse && !invitationExists && Date.parse(invitation.expiresAt) > Date.now()) {
      store.invitations.push({ ...invitation, tokenHash: hash });
    }
  });
}

export function syncAuthUsersFromTeam(workspaceId: string, team: TeamMember[]) {
  return mutateStore((store) => {
    for (const user of store.users.filter((item) => item.workspaceId === workspaceId)) {
      const member = team.find((item) => item.id === user.memberId);
      if (!member) {
        user.status = "disabled";
        store.sessions = store.sessions.filter((session) => session.userId !== user.userId);
        continue;
      }
      user.name = member.name;
      user.email = normalizeEmail(member.email);
      user.role = member.role;
      user.status = member.status === "active" ? "active" : "disabled";
      user.updatedAt = new Date().toISOString();
      if (user.status === "disabled") store.sessions = store.sessions.filter((session) => session.userId !== user.userId);
    }
    for (const invitation of store.invitations.filter((item) => item.workspaceId === workspaceId)) {
      const member = team.find((item) => item.id === invitation.memberId && item.status === "invited" && item.role !== "owner");
      if (!member) {
        store.invitations = store.invitations.filter((item) => item.tokenHash !== invitation.tokenHash);
        continue;
      }
      invitation.name = member.name;
      invitation.email = normalizeEmail(member.email);
      invitation.role = member.role as Exclude<WorkspaceRole, "owner">;
    }
  });
}
