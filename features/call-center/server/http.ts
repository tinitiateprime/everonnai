import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { AuthAccessError } from "@/features/auth/session";
import { callCenterDatabaseConfigured } from "@/lib/call-center-mysql";
import { InvalidIdError } from "../ids";
import { DeskError } from "../workflow";

export function deskJson<T>(payload: T, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return NextResponse.json(payload, { ...init, headers });
}

export function deskNotConfigured() {
  return callCenterDatabaseConfigured() ? null : deskJson({ error: "The call center database is not configured. Set CALL_CENTER_DATABASE_URL and run npm run call-center:db:migrate.", code: "not_configured" }, { status: 503 });
}

// Maps desk errors to the Appendix J error codes; unexpected errors are logged
// without request data and returned as a generic message.
export function deskError(error: unknown) {
  if (error instanceof DeskError) return deskJson({ error: error.message, code: error.code }, { status: error.status });
  if (error instanceof InvalidIdError) return deskJson({ error: error.message, code: "invalid_input" }, { status: 400 });
  if (error instanceof AuthAccessError) return deskJson({ error: error.message, code: error.status === 401 ? "unauthenticated" : "forbidden" }, { status: error.status });
  if (error instanceof SyntaxError) return deskJson({ error: "Request body must be JSON.", code: "invalid_input" }, { status: 400 });
  const code = (error as { code?: string }).code;
  console.error("[call-center]", code || "error", (error as Error)?.message);
  return deskJson({ error: "The call center service is temporarily unavailable.", code: "unavailable" }, { status: 503 });
}

// Service-to-service bearer secrets (intake from the AI runtime, cron sweep).
export function bearerMatches(request: Request, secret: string | undefined) {
  if (!secret || secret.length < 32) return false;
  const received = request.headers.get("authorization") || "";
  return timingSafeEqual(createHash("sha256").update(received).digest(), createHash("sha256").update(`Bearer ${secret}`).digest());
}
