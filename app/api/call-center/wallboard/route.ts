import { requireActor } from "@/features/auth/session";
import { loadWallboard } from "@/features/call-center/server/snapshot";
import { deskError, deskJson, deskNotConfigured } from "@/features/call-center/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Operator-lead wall board (DSK-020), approvals and QA candidates.
export async function GET() {
  const unavailable = deskNotConfigured();
  if (unavailable) return unavailable;
  try {
    return deskJson(await loadWallboard(await requireActor()));
  } catch (error) {
    return deskError(error);
  }
}
