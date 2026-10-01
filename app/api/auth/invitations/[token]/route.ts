import { NextResponse } from "next/server";
import { assertSameOrigin, authErrorDetails, setAuthCookie } from "@/features/auth/session";
import { acceptTeamInvitation, getTeamInvitation, rollbackAcceptedTeamInvitation } from "@/lib/auth-store";
import { readWorkspaceJson, updateWorkspaceJson } from "@/lib/json-workspace-store";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: RouteContext<"/api/auth/invitations/[token]">) {
  const { token } = await context.params;
  const invitation = await getTeamInvitation(token);
  if (!invitation) return NextResponse.json({ error: "This invitation is invalid or has expired." }, { status: 404 });
  const workspace = await readWorkspaceJson(invitation.workspaceId);
  const member = workspace.team.find((item) => item.id === invitation.memberId && item.status === "invited" && item.email.toLowerCase() === invitation.email && item.role === invitation.role);
  if (workspace.workspaceId !== invitation.workspaceId || !member) {
    return NextResponse.json({ error: "This invitation is no longer active." }, { status: 404 });
  }
  return NextResponse.json({ invitation: { name: invitation.name, email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt, businessName: workspace.profile.businessName } }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request, context: RouteContext<"/api/auth/invitations/[token]">) {
  try {
    assertSameOrigin(request);
    const { token } = await context.params;
    const raw = await request.text();
    if (!raw || raw.length > 2_000) return NextResponse.json({ error: "Invalid invitation acceptance request." }, { status: 400 });
    const input = JSON.parse(raw) as { password?: string };
    const invitation = await getTeamInvitation(token);
    if (!invitation) return NextResponse.json({ error: "This invitation is invalid or has expired." }, { status: 404 });
    const snapshot = await readWorkspaceJson(invitation.workspaceId);
    const invitedMember = snapshot.team.find((member) => member.id === invitation.memberId && member.status === "invited" && member.email.toLowerCase() === invitation.email && member.role === invitation.role);
    if (snapshot.workspaceId !== invitation.workspaceId || !invitedMember) {
      return NextResponse.json({ error: "This invitation is no longer active." }, { status: 404 });
    }
    const result = await acceptTeamInvitation(token, String(input.password || ""));
    try {
      await updateWorkspaceJson((workspace) => {
        if (workspace.workspaceId !== result.invitation.workspaceId) throw new Error("Workspace access denied.");
        const memberStillInvited = workspace.team.some((member) => member.id === result.invitation.memberId && member.status === "invited" && member.email.toLowerCase() === result.invitation.email && member.role === result.invitation.role);
        if (!memberStillInvited) throw new Error("This invitation is no longer active.");
        return {
          ...workspace,
          team: workspace.team.map((member) => member.id === result.invitation.memberId ? { ...member, status: "active", name: result.invitation.name, email: result.invitation.email, role: result.invitation.role } : member),
        };
      }, result.invitation.workspaceId);
    } catch (workspaceError) {
      await rollbackAcceptedTeamInvitation(result.actor.userId, token, result.invitation).catch(() => undefined);
      throw workspaceError;
    }
    const response = NextResponse.json({ authenticated: true, actor: result.actor }, { headers: { "Cache-Control": "private, no-store" } });
    setAuthCookie(response, result.token, request.url);
    return response;
  } catch (error) {
    const details = authErrorDetails(error);
    return NextResponse.json({ error: details.message }, { status: details.status, headers: { "Cache-Control": "private, no-store" } });
  }
}
