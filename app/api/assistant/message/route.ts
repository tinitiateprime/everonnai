import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import type { AiConversationMessage } from "@/features/voice-agent/gemini";
import { generateAssistantReply } from "@/features/voice-agent/gemini";
import { readWorkspaceJson } from "@/lib/json-workspace-store";

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
    const raw = await request.text();
    if (!raw || raw.length > 30_000) return NextResponse.json({ error: "Invalid AI message request." }, { status: 400 });
    const input = JSON.parse(raw) as { previewToken?: string; publicSlug?: string; messages?: AiConversationMessage[] };
    if (!Array.isArray(input.messages)) return NextResponse.json({ error: "Conversation messages are required." }, { status: 400 });
    const workspace = await readWorkspaceJson();
    const project = workspace.websiteProject;
    const selectedWorkspace = request.headers.get("x-everonn-workspace");
    const workspaceAllowed = selectedWorkspace === workspace.workspaceId;
    const previewAllowed = Boolean(input.previewToken && project?.privateToken === input.previewToken);
    const publicAllowed = Boolean(input.publicSlug && project?.publicSlug === input.publicSlug && project.status === "published");
    if (!workspaceAllowed && !previewAllowed && !publicAllowed) return NextResponse.json({ error: "AI assistant access denied." }, { status: 403 });
    enforceRateLimit(request, project?.id || workspace.workspaceId);
    const result = await generateAssistantReply(workspace.profile, input.messages);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The AI assistant could not respond.";
    return NextResponse.json({ error: message }, { status: message.startsWith("Please wait") ? 429 : 502, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  }
}
