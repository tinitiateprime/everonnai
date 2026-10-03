import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { buildVoiceSessionVariables } from "@/features/voice-agent/session-context";
import { getGoogleConnection } from "@/lib/provider-credentials";
import { assertSameOrigin, authErrorDetails } from "@/features/auth/session";
import { findWorkspaceJson } from "@/lib/json-workspace-store";
import { meteredElevenLabsSetup } from "@/features/usage/elevenlabs";
import { createUsageSession } from "@/lib/usage-store";

export const dynamic = "force-dynamic";

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

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const raw = await request.text();
    if (raw.length > 4_000) return NextResponse.json({ error: "Invalid assistant request." }, { status: 400 });
    const input = raw ? JSON.parse(raw) as { previewToken?: string; publicSlug?: string; mode?: "voice" | "chat" } : {};
    if (input.mode && input.mode !== "voice" && input.mode !== "chat") return NextResponse.json({ error: "Invalid assistant mode." }, { status: 400 });
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
    const usage = { workspaceId: workspace.workspaceId, feature: input.mode === "chat" ? "elevenlabs_chat" as const : "website_voice" as const };
    const [token, signedUrl] = await Promise.all([
      meteredElevenLabsSetup(`/convai/conversation/token?agent_id=${encoded}`, apiKey, usage, agentId),
      meteredElevenLabsSetup(`/convai/conversation/get-signed-url?agent_id=${encoded}`, apiKey, usage, agentId),
    ]);
    const usageSessionId = await createUsageSession(usage, agentId);
    const profile = workspace.profile;
    const googleConnection = await getGoogleConnection(workspace.workspaceId);
    return NextResponse.json({
      configured: true,
      conversationToken: token.token,
      signedUrl: signedUrl.signed_url,
      usageSessionId,
      dynamicVariables: buildVoiceSessionVariables(profile, Boolean(googleConnection?.scope.some((scope) => scope.includes("calendar")))),
      assistant: { name: profile.assistantName, businessName: profile.businessName, greeting: profile.greeting },
      expiresAt: new Date(Date.now() + 14 * 60_000).toISOString(),
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    const details = authErrorDetails(error, 502);
    const status = details.message.startsWith("Please wait") ? 429 : details.status;
    return NextResponse.json({ error: details.message || "The AI assistant is temporarily unavailable." }, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  }
}
