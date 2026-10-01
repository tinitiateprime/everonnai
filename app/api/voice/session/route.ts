import { NextResponse } from "next/server";
import { buildReceptionistPrompt } from "@/features/voice-agent/engine";
import { getProviderReadiness } from "@/lib/provider-config";
import { readWorkspaceJson } from "@/lib/json-workspace-store";
import { assertSameOrigin, authErrorDetails, requireActor } from "@/features/auth/session";

const elevenLabsApi = "https://api.elevenlabs.io/v1";

async function elevenLabs(path: string, apiKey: string) {
  const response = await fetch(`${elevenLabsApi}${path}`, {
    headers: { "xi-api-key": apiKey },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.detail?.message || payload?.message || `ElevenLabs returned HTTP ${response.status}.`);
  return payload;
}

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
    const encoded = encodeURIComponent(agentId);
    const [token, signedUrl] = await Promise.all([
      elevenLabs(`/convai/conversation/token?agent_id=${encoded}`, apiKey),
      elevenLabs(`/convai/conversation/get-signed-url?agent_id=${encoded}`, apiKey),
    ]);
    return NextResponse.json({
      configured: true,
      conversationToken: token.token,
      signedUrl: signedUrl.signed_url,
      dynamicVariables: {
        business_name: profile.businessName,
        business_type: profile.businessType,
        assistant_name: profile.assistantName,
        services: profile.services.filter((item) => item.active).map((item) => item.name).join(", "),
        business_hours: profile.hours,
        service_area: profile.serviceArea,
        greeting: profile.greeting,
        approved_instructions: buildReceptionistPrompt(profile),
        transfer_number_configured: profile.transferNumber ? "yes" : "no",
        time_zone: profile.timeZone,
        appointment_duration_minutes: String(profile.appointmentDurationMinutes),
      },
      expiresAt: new Date(Date.now() + 14 * 60_000).toISOString(),
    });
  } catch (error) {
    const details = authErrorDetails(error, 502);
    return NextResponse.json({ configured: true, error: details.message || "Unable to create the voice session." }, { status: details.status });
  }
}
