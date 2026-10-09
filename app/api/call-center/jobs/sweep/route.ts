import { runSweep } from "@/features/call-center/server/routing";
import { bearerMatches, deskError, deskJson, deskNotConfigured } from "@/features/call-center/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Durable timer sweep for when no desk is polling (offer timeouts, cascade,
// heartbeat loss, wrap-up release). Schedule every 5-10 seconds.
export async function POST(request: Request) {
  const unavailable = deskNotConfigured();
  if (unavailable) return unavailable;
  if (!bearerMatches(request, process.env.CALL_CENTER_CRON_SECRET)) return deskJson({ error: "Unauthorized.", code: "forbidden" }, { status: 401 });
  try {
    return deskJson(await runSweep(true));
  } catch (error) {
    return deskError(error);
  }
}
