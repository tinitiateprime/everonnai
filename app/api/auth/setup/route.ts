import { NextResponse } from "next/server";
import { assertSameOrigin, authErrorDetails, setAuthCookie } from "@/features/auth/session";
import { initializeOwnerAccount, rollbackNewAccount } from "@/lib/auth-store";
import { readWorkspaceJson, updateWorkspaceJson } from "@/lib/json-workspace-store";

export const dynamic = "force-dynamic";

function clean(value: unknown, maximum: number) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maximum);
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const raw = await request.text();
    if (!raw || raw.length > 4_000) return NextResponse.json({ error: "Invalid owner setup request." }, { status: 400 });
    const input = JSON.parse(raw) as { name?: string; email?: string; password?: string; setupToken?: string };
    const name = clean(input.name, 120);
    const email = clean(input.email, 254).toLowerCase();
    const password = String(input.password || "");
    if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Enter the owner name and a valid work email." }, { status: 400 });
    }
    const workspace = await readWorkspaceJson();
    const existingOwner = workspace.team.find((member) => member.role === "owner");
    const memberId = existingOwner?.id || `member_${crypto.randomUUID()}`;
    const result = await initializeOwnerAccount({ workspaceId: workspace.workspaceId, memberId, name, email, password, setupToken: String(input.setupToken || "") });
    try {
      await updateWorkspaceJson((current) => ({
        ...current,
        team: current.team.some((member) => member.id === memberId)
          ? current.team.map((member) => member.id === memberId ? { ...member, name, email, role: "owner", status: "active" } : member)
          : [{ id: memberId, name, email, role: "owner", status: "active" }, ...current.team],
      }));
    } catch (workspaceError) {
      await rollbackNewAccount(result.actor.userId).catch(() => undefined);
      throw workspaceError;
    }
    const response = NextResponse.json({ authenticated: true, actor: result.actor }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
    setAuthCookie(response, result.token, request.url);
    return response;
  } catch (error) {
    const details = authErrorDetails(error);
    return NextResponse.json({ error: details.message }, { status: details.status, headers: { "Cache-Control": "private, no-store" } });
  }
}
