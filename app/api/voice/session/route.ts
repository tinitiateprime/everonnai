import { NextResponse } from "next/server";
import type { BusinessProfile } from "@/features/everonn/types";
import { buildReceptionistPrompt } from "@/features/voice-agent/engine";

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
  return NextResponse.json({ configured: Boolean(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_AGENT_ID) });
}

export async function POST(request: Request) {
  try {
    const apiKey = String(process.env.ELEVENLABS_API_KEY || "").trim();
    const agentId = String(process.env.ELEVENLABS_AGENT_ID || "").trim();
    if (!apiKey || !agentId) return NextResponse.json({ configured: false, error: "ElevenLabs is not configured. The browser-voice demo remains available." }, { status: 503 });
    const { profile } = await request.json() as { profile?: BusinessProfile };
    if (!profile?.workspaceId) return NextResponse.json({ error: "A workspace business profile is required." }, { status: 400 });
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
    return NextResponse.json({ configured: true, error: error instanceof Error ? error.message : "Unable to create the voice session." }, { status: 502 });
  }
}
