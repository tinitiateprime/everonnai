import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { actorTransaction, type PlatformDatabase } from "../platform/database";
import { platformOrigin, PlatformError } from "../platform/config";

export type Actor = { id: string; displayName: string };
const identitySchema = z.object({
  issuer: z.string().min(1).max(2048),
  subject: z.string().min(1).max(255),
  displayName: z.string().trim().min(1).max(120),
});
export const sessionHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export function sessionCookieName() {
  return new URL(platformOrigin()).protocol === "https:"
    ? "__Host-everonn-session"
    : "everonn-session";
}
export function readCookie(request: Request, name: string) {
  const values = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(name + "="));
  return values.length === 1 ? values[0].slice(name.length + 1) : undefined;
}
export function cookie(name: string, value: string, maxAge: number) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(platformOrigin()).protocol === "https:" ? "; Secure" : ""}`;
}

export async function createSession(
  db: PlatformDatabase,
  identity: z.infer<typeof identitySchema>,
) {
  const verified = identitySchema.parse(identity);
  const token = randomBytes(32).toString("base64url");
  const user = await db.transaction(async (client) => {
    await client.exec("SET LOCAL ROLE everonn_platform_app");
    await client.query(
      "SELECT set_config('everonn.issuer',$1,true), set_config('everonn.subject',$2,true)",
      [verified.issuer, verified.subject],
    );
    const result = await client.query<Actor>(
      `INSERT INTO everonn_platform.users (id,issuer,subject,display_name)
      VALUES ($1,$2,$3,$4) ON CONFLICT (issuer,subject) DO UPDATE SET display_name=excluded.display_name
      RETURNING id,display_name AS "displayName"`,
      [randomUUID(), verified.issuer, verified.subject, verified.displayName],
    );
    await client.query("SELECT set_config('everonn.actor_id',$1,true)", [
      result.rows[0].id,
    ]);
    await client.query(
      "INSERT INTO everonn_platform.sessions (id,user_id,token_hash,expires_at) VALUES ($1,$2,$3,now()+interval '8 hours')",
      [randomUUID(), result.rows[0].id, sessionHash(token)],
    );
    return result.rows[0];
  });
  return { user, token };
}

export async function sessionActor(
  db: PlatformDatabase,
  token?: string,
): Promise<Actor | null> {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const userId = await db.transaction(async (client) => {
    await client.exec("SET LOCAL ROLE everonn_platform_app");
    await client.query("SELECT set_config('everonn.session_hash',$1,true)", [
      sessionHash(token),
    ]);
    const result = await client.query<{ user_id: string }>(
      "SELECT user_id FROM everonn_platform.sessions WHERE token_hash=$1 AND expires_at>now()",
      [sessionHash(token)],
    );
    return result.rows[0]?.user_id;
  });
  if (!userId) return null;
  return actorTransaction(
    db,
    userId,
    async (client) =>
      (
        await client.query<Actor>(
          'SELECT id,display_name AS "displayName" FROM everonn_platform.users WHERE id=$1',
          [userId],
        )
      ).rows[0] ?? null,
  );
}

export async function requireActor(db: PlatformDatabase, request: Request) {
  const actor = await sessionActor(
    db,
    readCookie(request, sessionCookieName()),
  );
  if (!actor) throw new PlatformError("Sign in to access your workspace.", 401);
  return actor;
}
export async function revokeSession(db: PlatformDatabase, token?: string) {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return;
  await db.transaction(async (client) => {
    await client.exec("SET LOCAL ROLE everonn_platform_app");
    await client.query("SELECT set_config('everonn.session_hash',$1,true)", [
      sessionHash(token),
    ]);
    await client.query(
      "DELETE FROM everonn_platform.sessions WHERE token_hash=$1",
      [sessionHash(token)],
    );
  });
}
