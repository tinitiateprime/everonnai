import "server-only";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { authorizeWorkspaceAction, type Capability } from "./rbac";
import type { AuthActor } from "./types";
import { actorForSessionToken } from "@/lib/auth-store";

export const authCookieName = "everonn_session";
export const authSessionMaxAge = 7 * 24 * 60 * 60;

export class AuthAccessError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function getCurrentActor() {
  const token = (await cookies()).get(authCookieName)?.value || "";
  return actorForSessionToken(token);
}

export async function requireActor(capability?: Capability, workspaceId?: string) {
  const actor = await getCurrentActor();
  if (!actor) throw new AuthAccessError("Sign in to continue.", 401);
  try {
    if (workspaceId) authorizeWorkspaceAction(actor, { workspaceId }, capability || "workspace:view");
    else if (capability) authorizeWorkspaceAction(actor, { workspaceId: actor.workspaceId }, capability);
  } catch (error) {
    throw new AuthAccessError(error instanceof Error ? error.message : "Access denied.", 403);
  }
  return actor;
}

export function setAuthCookie(response: NextResponse, token: string, requestUrl: string) {
  response.cookies.set(authCookieName, token, {
    httpOnly: true,
    secure: new URL(requestUrl).protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: authSessionMaxAge,
    priority: "high",
  });
}

export function clearAuthCookie(response: NextResponse, requestUrl: string) {
  response.cookies.set(authCookieName, "", {
    httpOnly: true,
    secure: new URL(requestUrl).protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new AuthAccessError("Cross-origin request denied.", 403);
}

export function authErrorDetails(error: unknown, fallbackStatus = 400) {
  if (error instanceof AuthAccessError) return { message: error.message, status: error.status };
  const status = Number((error as { status?: number } | null)?.status || 0);
  return { message: error instanceof Error ? error.message : "Authentication request failed.", status: status >= 400 && status < 600 ? status : fallbackStatus };
}

export type { AuthActor };
