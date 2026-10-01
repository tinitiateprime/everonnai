import { NextResponse } from "next/server";
import type { WorkspaceRole } from "@/features/everonn/types";
import { assertSameOrigin, authErrorDetails, requireActor } from "@/features/auth/session";
import { cancelTeamInvitation, createTeamInvitation } from "@/lib/auth-store";
import { updateWorkspaceJson } from "@/lib/json-workspace-store";

export const dynamic = "force-dynamic";

function clean(value: unknown, maximum: number) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maximum);
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireActor("team:manage");
    const raw = await request.text();
    if (!raw || raw.length > 3_000) return NextResponse.json({ error: "Invalid invitation request." }, { status: 400 });
    const input = JSON.parse(raw) as { name?: string; email?: string; role?: WorkspaceRole };
    const email = clean(input.email, 254).toLowerCase();
    const name = clean(input.name, 120) || email.split("@")[0];
    const role = input.role;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !role || !["manager", "agent", "viewer"].includes(role)) {
      return NextResponse.json({ error: "Enter a valid email and non-owner role." }, { status: 400 });
    }
    const memberId = `member_${crypto.randomUUID()}`;
    const created = await createTeamInvitation({ actor, memberId, name, email, role: role as Exclude<WorkspaceRole, "owner"> });
    let workspace;
    try {
      workspace = await updateWorkspaceJson((current) => {
        if (current.workspaceId !== actor.workspaceId) throw new Error("Workspace access denied.");
        const member = { id: memberId, name, email, role, status: "invited" as const };
        return { ...current, team: [...current.team.filter((item) => item.email.toLowerCase() !== email), member] };
      }, actor.workspaceId);
    } catch (workspaceError) {
      await cancelTeamInvitation(created.token).catch(() => undefined);
      throw workspaceError;
    }
    const member = workspace.team.find((item) => item.id === memberId)!;
    const inviteUrl = new URL(`/join/${created.token}`, request.url).toString();
    return NextResponse.json({ member, inviteUrl, expiresAt: created.invitation.expiresAt }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const details = authErrorDetails(error);
    return NextResponse.json({ error: details.message }, { status: details.status, headers: { "Cache-Control": "private, no-store" } });
  }
}
