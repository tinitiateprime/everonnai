import { authorizedUsageJob } from "@/features/usage/job-auth";
import { runUsageWorker } from "@/features/usage/worker";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!authorizedUsageJob(request)) return Response.json({ error: "Unauthorized usage job." }, { status: 401, headers });
  try {
    const result = await runUsageWorker();
    return Response.json(result, { status: result.error ? 503 : 200, headers });
  } catch { return Response.json({ error: "Usage reconciliation failed. Check storage and provider access." }, { status: 503, headers }); }
}
