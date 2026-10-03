import { authorizedUsageJob, signedUsageJobNonce } from "@/features/usage/job-auth";
import { runUsageWorker } from "@/features/usage/worker";
import { claimUsageJobNonce } from "@/lib/usage-store";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const bearer = authorizedUsageJob(request);
  const nonce = bearer ? null : signedUsageJobNonce(request);
  if (!bearer && !nonce) return Response.json({ error: "Unauthorized usage job." }, { status: 401, headers });
  try {
    if (nonce && !await claimUsageJobNonce(nonce)) return Response.json({ error: "Usage job signature was already used." }, { status: 409, headers });
    const result = await runUsageWorker();
    return Response.json(result, { status: result.error ? 503 : 200, headers });
  } catch { return Response.json({ error: "Usage reconciliation failed. Check storage and provider access." }, { status: 503, headers }); }
}
