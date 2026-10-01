import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { buildReceptionistPrompt } from "@/features/voice-agent/engine";
import { assertSameOrigin, authErrorDetails } from "@/features/auth/session";
import { findWorkspaceJson } from "@/lib/json-workspace-store";

export const dynamic = "force-dynamic";

const elevenLabsApi = "https://api.elevenlabs.io/v1";
const sessionBuckets = new Map<string, number[]>();

function visitorKey(request: Request, projectId: string) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0] || "local";
  const agent = request.headers.get("user-agent") || "unknown";
  return createHash("sha256").update(`${projectId}|${forwarded}|${agent}`).digest("hex");
}

function enforceRateLimit(key: string) {
  const now = Date.now();
  const recent = (sessionBuckets.get(key) || []).filter((timestamp) => now - timestamp < 15 * 60_000);
  if (recent.length >= 8) throw new Error("Please wait a few minutes before starting another AI conversation.");
  sessionBuckets.set(key, [...recent, now]);
}

async function elevenLabs(path: string, apiKey: string) {
  const response = await fetch(`${elevenLabsApi}${path}`, {
    headers: { "xi-api-key": apiKey },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.detail?.message || payload?.message || `ElevenLabs returned HTTP ${response.status}.`);
  return payload as { token?: string; signed_url?: string };
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const raw = await request.text();
    if (raw.length > 4_000) return NextResponse.json({ error: "Invalid assistant request." }, { status: 400 });
    const input = raw ? JSON.parse(raw) as { previewToken?: string; publicSlug?: string } : {};
    const workspace = await findWorkspaceJson((candidate) => Boolean(
      (input.previewToken && candidate.websiteProject?.privateToken === input.previewToken)
      || (input.publicSlug && candidate.websiteProject?.publicSlug === input.publicSlug && candidate.websiteProject.status === "published")
    ));
    if (!workspace) return NextResponse.json({ error: "This website assistant is unavailable." }, { status: 404 });
    const project = workspace.websiteProject;
    const previewAllowed = Boolean(input.previewToken && project?.privateToken === input.previewToken);
    const publicAllowed = Boolean(input.publicSlug && project?.publicSlug === input.publicSlug && project.status === "published");
    if (!project || (!previewAllowed && !publicAllowed)) return NextResponse.json({ error: "This website assistant is unavailable." }, { status: 404 });
    enforceRateLimit(visitorKey(request, project.id));

    const apiKey = String(process.env.ELEVENLABS_API_KEY || "").trim();
    const agentId = String(process.env.ELEVENLABS_AGENT_ID || "").trim();
    if (!apiKey || !agentId) return NextResponse.json({ configured: false, error: "Live AI voice is not configured." }, { status: 503 });
    const encoded = encodeURIComponent(agentId);
    const [token, signedUrl] = await Promise.all([
      elevenLabs(`/convai/conversation/token?agent_id=${encoded}`, apiKey),
      elevenLabs(`/convai/conversation/get-signed-url?agent_id=${encoded}`, apiKey),
    ]);
    const profile = workspace.profile;
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
        pricing_rules: profile.pricingRules,
        policies: profile.policies,
        time_zone: profile.timeZone,
      },
      assistant: { name: profile.assistantName, businessName: profile.businessName, greeting: profile.greeting },
      expiresAt: new Date(Date.now() + 14 * 60_000).toISOString(),
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    const details = authErrorDetails(error, 502);
    const status = details.message.startsWith("Please wait") ? 429 : details.status;
    return NextResponse.json({ error: details.message || "The AI assistant is temporarily unavailable." }, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  }
}
