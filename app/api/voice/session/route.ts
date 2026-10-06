import { NextResponse } from "next/server";
import { buildVoiceSessionVariables } from "@/features/voice-agent/session-prompt";
import { getGoogleConnection } from "@/lib/provider-credentials";
import { getProviderReadiness } from "@/lib/provider-config";
import { readWorkspaceJson } from "@/lib/json-workspace-store";
import { assertSameOrigin, authErrorDetails, requireActor } from "@/features/auth/session";
import { meteredElevenLabsSetup } from "@/features/usage/elevenlabs";
import { createUsageSession } from "@/lib/usage-store";
import { workflowAvailability } from "@/features/agent-runtime/tool-registry";

export async function GET() {
  try {
    await requireActor("workspace:view");
    return NextResponse.json({ configured: getProviderReadiness().elevenLabs });
  } catch (error) {
    const details = authErrorDetails(error);
    return NextResponse.json({ error: details.message }, { status: details.status });
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const apiKey = String(process.env.ELEVENLABS_API_KEY || "").trim();
    const agentId = String(process.env.ELEVENLABS_AGENT_ID || "").trim();
    if (!apiKey || !agentId) return NextResponse.json({ configured: false, error: "ElevenLabs voice is not configured." }, { status: 503 });
    const selectedWorkspace = request.headers.get("x-everonn-workspace");
    if (!selectedWorkspace) return NextResponse.json({ error: "Workspace access denied." }, { status: 403 });
    await requireActor("calls:operate", selectedWorkspace);
    const workspace = await readWorkspaceJson(selectedWorkspace);
    const profile = workspace.profile;
    const googleConnection = await getGoogleConnection(workspace.workspaceId);
    const actions = workflowAvailability(profile, googleConnection?.scope, String(process.env.PHONE_FRONT_DESK_FOLLOW_UP_ENABLED || "true").trim().toLowerCase() !== "false");
    const encoded = encodeURIComponent(agentId);
    const usage = { workspaceId: workspace.workspaceId, feature: "dashboard_voice" as const };
    const [token, signedUrl] = await Promise.all([
      meteredElevenLabsSetup(`/convai/conversation/token?agent_id=${encoded}`, apiKey, usage, agentId),
      meteredElevenLabsSetup(`/convai/conversation/get-signed-url?agent_id=${encoded}`, apiKey, usage, agentId),
    ]);
    const usageSessionId = await createUsageSession(usage, agentId);
    return NextResponse.json({
      configured: true,
      conversationToken: token.token,
      signedUrl: signedUrl.signed_url,
      usageSessionId,
      dynamicVariables: buildVoiceSessionVariables(profile, actions.calendarConnected, actions),
      expiresAt: new Date(Date.now() + 14 * 60_000).toISOString(),
    });
  } catch (error) {
    const details = authErrorDetails(error, 502);
    return NextResponse.json({ configured: true, error: details.message || "Unable to create the voice session." }, { status: details.status });
  }
}
