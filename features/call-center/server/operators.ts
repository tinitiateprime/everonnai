import "server-only";
import type { DeskTx } from "@/lib/call-center-mysql";
import type { AuthActor } from "@/features/auth/types";
import type { OperatorRole } from "../types";
import { DeskError } from "../workflow";

export type OperatorRow = {
  id: Buffer; org_id: Buffer; auth_user_id: string | null; email: string; display_name: string; first_name: string; role: OperatorRole; languages: string[];
  max_voice: number; max_chat: number; announcement_enabled: number; missed_offer_limit: number; status: string;
};

// Operators are platform-level (§21.4). A signed-in EverOnn user becomes an
// operator when an operator row is linked to their user id, or — on first
// sign-in only — when an unlinked row carries the same email address.
export async function resolveOperator(tx: DeskTx, actor: AuthActor) {
  const [linked] = await tx.rows<OperatorRow>("SELECT * FROM operators WHERE auth_user_id = ?", [actor.userId]);
  if (linked) return linked.status === "active" ? linked : null;
  const [byEmail] = await tx.rows<OperatorRow>("SELECT * FROM operators WHERE auth_user_id IS NULL AND email = ?", [actor.email.toLowerCase()]);
  if (!byEmail || byEmail.status !== "active") return null;
  const result = await tx.run("UPDATE operators SET auth_user_id = ?, updated_at = UTC_TIMESTAMP(3), version = version + 1 WHERE id = ? AND auth_user_id IS NULL", [actor.userId, byEmail.id]);
  return result.affectedRows === 1 ? { ...byEmail, auth_user_id: actor.userId } : null;
}

// Every command touching client data is authorized against the operator's
// grant (ACC-001, DSK-002): not revoked, not expired, certified.
export async function assertGrant(tx: DeskTx, operatorId: Buffer, tenantId: Buffer, now: Date) {
  const [grant] = await tx.rows<{ ok: number }>(
    `SELECT 1 AS ok FROM operator_client_grants
      WHERE operator_id = ? AND tenant_id = ? AND revoked_at IS NULL AND certified_at IS NOT NULL AND (expires_at IS NULL OR expires_at > ?)`,
    [operatorId, tenantId, now],
  );
  if (!grant) throw new DeskError("not_granted", "You are not granted access to this client.", 403);
}

export function assertLead(operator: OperatorRow) {
  if (operator.role !== "operator_lead") throw new DeskError("forbidden", "Only an operator lead can do this.", 403);
}
