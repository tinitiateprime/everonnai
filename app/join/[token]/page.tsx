import { redirect } from "next/navigation";
import { JoinClient } from "@/components/auth/join-client";
import { getCurrentActor } from "@/features/auth/session";
import { getTeamInvitation } from "@/lib/auth-store";
import { readWorkspaceJson } from "@/lib/json-workspace-store";
import "../../login/login.css";

export const dynamic = "force-dynamic";

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const actor = await getCurrentActor();
  if (actor) redirect("/dashboard");
  const { token } = await params;
  const invitation = await getTeamInvitation(token);
  const workspace = invitation ? await readWorkspaceJson() : null;
  return <JoinClient token={token} invitation={invitation ? { name: invitation.name, email: invitation.email, role: invitation.role, businessName: workspace!.profile.businessName, expiresAt: invitation.expiresAt } : null} />;
}
