import { requireActor } from "@/features/auth/session";
import { loadDirectory } from "@/features/call-center/server/snapshot";
import { deskError, deskJson, deskNotConfigured } from "@/features/call-center/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Granted clients only: scripts, notes, authority, hours (screen inventory "Client directory").
export async function GET() {
  const unavailable = deskNotConfigured();
  if (unavailable) return unavailable;
  try {
    return deskJson({ clients: await loadDirectory(await requireActor()) });
  } catch (error) {
    return deskError(error);
  }
}
