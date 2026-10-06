import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { websiteAccess } from "@/features/website-studio/site-access";
import type { AiConversationMessage } from "@/features/voice-agent/gemini";
import { generateAssistantReply } from "@/features/voice-agent/gemini";
import { findWorkspaceJson, readWorkspaceJson } from "@/lib/json-workspace-store";
import { hasCapability } from "@/features/auth/rbac";
import { assertSameOrigin, authErrorDetails, getCurrentActor } from "@/features/auth/session";
import { getGoogleConnection } from "@/lib/provider-credentials";
import { workflowAvailability } from "@/features/agent-runtime/tool-registry";

export const dynamic = "force-dynamic";

const buckets = new Map<string, number[]>();

function enforceRateLimit(request: Request, scope: string) {
  const visitor = request.headers.get("x-forwarded-for")?.split(",")[0] || "local";
  const key = createHash("sha256").update(`${scope}|${visitor}`).digest("hex");
  const now = Date.now();
  const recent = (buckets.get(key) || []).filter((timestamp) => now - timestamp < 15 * 60_000);
  if (recent.length >= 40) throw new Error("Please wait before sending more AI messages.");
  buckets.set(key, [...recent, now]);
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const raw = await request.text();
    if (!raw || raw.length > 30_000) return NextResponse.json({ error: "Invalid AI message request." }, { status: 400 });
    const input = JSON.parse(raw) as { previewToken?: string; publicSlug?: string; messages?: AiConversationMessage[] };
    if (!Array.isArray(input.messages)) return NextResponse.json({ error: "Conversation messages are required." }, { status: 400 });
    const selectedWorkspace = request.headers.get("x-everonn-workspace");
    const actor = selectedWorkspace ? await getCurrentActor() : null;
    const workspaceAllowed = Boolean(selectedWorkspace && actor?.workspaceId === selectedWorkspace && hasCapability(actor.role, "calls:operate"));
    const workspace = workspaceAllowed
      ? await readWorkspaceJson(selectedWorkspace!)
      : selectedWorkspace
        ? null
        : await findWorkspaceJson((candidate) => Boolean(
          websiteAccess(candidate, input)
        ));
    if (!workspace) return NextResponse.json({ error: "AI assistant access denied." }, { status: 403 });
    const project = websiteAccess(workspace, input);
    const previewAllowed = Boolean(input.previewToken && project?.privateToken === input.previewToken);
    const publicAllowed = Boolean(input.publicSlug && websiteAccess(workspace, { publicSlug: input.publicSlug }));
    if (!workspaceAllowed && !previewAllowed && !publicAllowed) return NextResponse.json({ error: "AI assistant access denied." }, { status: 403 });
    enforceRateLimit(request, project?.id || workspace.workspaceId);
    const result = await generateAssistantReply(workspace.profile, input.messages, { workspaceId: workspace.workspaceId, feature: workspaceAllowed ? "call_chat" : "website_chat" }, {
      resolveActions: async () => workflowAvailability(workspace.profile, (await getGoogleConnection(workspace.workspaceId))?.scope,
        String(process.env.PHONE_FRONT_DESK_FOLLOW_UP_ENABLED || "true").trim().toLowerCase() !== "false"),
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    const details = authErrorDetails(error, 502);
    const status = details.message.startsWith("Please wait") ? 429 : details.status;
    return NextResponse.json({ error: details.message || "The AI assistant could not respond." }, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  }
}
