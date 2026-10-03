import { NextResponse } from "next/server";
import { authErrorDetails, requireActor } from "@/features/auth/session";
import { summarizeUsage, usagePeriods, type UsagePeriod } from "@/features/usage/summary";
import { readWorkspaceJson } from "@/lib/json-workspace-store";
import { readUsageEvents, readUsageSessions, readGeminiBilling } from "@/lib/usage-store";
import { usageHealth } from "@/features/usage/health";
import { estimateGeminiCost } from "@/features/usage/pricing";
import { summarizeBilling } from "@/features/usage/billing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(request: Request) {
  try {
    const actor = await requireActor("usage:view");
    const period = new URL(request.url).searchParams.get("period") || "month";
    if (!Object.hasOwn(usagePeriods, period)) return NextResponse.json({ error: "Invalid usage period." }, { status: 400, headers });
    const [workspace, events, sessions, health, report] = await Promise.all([readWorkspaceJson(actor.workspaceId), readUsageEvents(actor.workspaceId), readUsageSessions(actor.workspaceId), usageHealth(actor.workspaceId), readGeminiBilling(actor.workspaceId)]);
    const measured = events.map((event) => event.provider === "gemini" && !event.estimatedCost ? { ...event, estimatedCost: estimateGeminiCost(event.model, event.tokens, { timestamp: event.startedAt }) } : event);
    const summary = { ...summarizeUsage(measured, sessions, { workspaceId: actor.workspaceId, timeZone: workspace.profile.timeZone || "UTC", period: period as UsagePeriod }), health, billing: summarizeBilling(report, actor.workspaceId, period as UsagePeriod) };
    // Models/agent identifiers are useful to the operator; workspace identifiers
    // and opaque session identities are never sent with metering records.
    return NextResponse.json({ summary }, { headers });
  } catch (error) {
    const details = authErrorDetails(error, 500);
    return NextResponse.json({ error: details.message }, { status: details.status, headers });
  }
}
