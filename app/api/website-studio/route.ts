import { NextResponse } from "next/server";
import { createWebsiteJobRunner } from "@/features/website-studio/jobs";
import { getProviderReadiness } from "@/lib/provider-config";
import { assertSameOrigin, authErrorDetails, requireActor } from "@/features/auth/session";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const actor = await requireActor("website:publish", request.headers.get("x-everonn-workspace") || undefined);
    const jobId = new URL(request.url).searchParams.get("jobId") || undefined;
    const providers = getProviderReadiness();
    return NextResponse.json({
      available: true, concepts: ["editorial", "momentum", "aura"],
      generationMode: providers.gemini ? "gemini-required-with-qa" : "configuration-required", providers,
      gates: ["private-preview", "owner-claim", "owner-verification", "approval", "publish"],
      ...await createWebsiteJobRunner().status(actor, jobId),
    }, { headers });
  } catch (error) {
    const details = authErrorDetails(error);
    return NextResponse.json({ error: details.message }, { status: details.status, headers });
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const raw = await request.text();
    if (raw.length > 60_000) return NextResponse.json({ error: "The generation request is too large." }, { status: 413, headers });
    let body: { workspaceId?: string; profile?: { workspaceId?: string }; operation?: string; jobId?: string };
    try { body = raw ? JSON.parse(raw) : {}; }
    catch { return NextResponse.json({ error: "The website generation request is invalid." }, { status: 400, headers }); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid generation request." }, { status: 400, headers });
    const operation = body.operation || "start";
    if (!["start", "advance", "resume"].includes(operation) || (operation !== "start" && (typeof body.jobId !== "string" || !/^[a-f0-9-]{36}$/i.test(body.jobId)))) {
      return NextResponse.json({ error: "Choose a valid website build operation." }, { status: 400, headers });
    }
    const actor = await requireActor("website:publish", body.workspaceId || body.profile?.workspaceId);
    const selected = request.headers.get("x-everonn-workspace");
    if (selected && selected !== actor.workspaceId) return NextResponse.json({ error: "The profile does not belong to the selected workspace." }, { status: 403, headers });
    const runner = createWebsiteJobRunner();
    const result = operation === "start" ? await runner.start(actor) : operation === "resume" ? await runner.resume(actor, body.jobId!) : await runner.advance(actor, body.jobId!);
    return NextResponse.json(result, { status: result.job?.status === "running" ? 202 : 200, headers });
  } catch (error) {
    const details = authErrorDetails(error);
    return NextResponse.json({ error: details.message || "Unable to generate the website project." }, { status: details.status, headers });
  }
}
