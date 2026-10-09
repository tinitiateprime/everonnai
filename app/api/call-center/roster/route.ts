import { requireActor } from "@/features/auth/session";
import { loadRoster } from "@/features/call-center/server/snapshot";
import { deskError, deskJson, deskNotConfigured } from "@/features/call-center/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Operator-lead roster: operators, clients with lines, and grants (DSK-002).
export async function GET() {
  const unavailable = deskNotConfigured();
  if (unavailable) return unavailable;
  try {
    return deskJson(await loadRoster(await requireActor()));
  } catch (error) {
    return deskError(error);
  }
}
