import "server-only";
import type { DeskTx } from "@/lib/call-center-mysql";
import type { EscalationState, HandlingChannel, HandlingState } from "../types";
import { newId } from "../ids";
import { assertEscalationTransition, assertHandlingTransition, callbackDueSeconds, DeskError } from "../workflow";
import type { EscalationRow } from "./context";
import { ext, type Unit } from "./unit";

// Shared state changes used by commands, intake and the sweep. Each one
// validates the §16.6 transition, bumps `version`, and journals the change.

export async function lockEscalation(tx: DeskTx, tenantId: Buffer, escalationId: Buffer) {
  const [row] = await tx.rows<EscalationRow>("SELECT * FROM escalations WHERE tenant_id = ? AND id = ? FOR UPDATE", [tenantId, escalationId]);
  if (!row) throw new DeskError("not_found", "Escalation not found.", 404);
  return row;
}

export async function moveEscalation(unit: Unit, escalation: EscalationRow, to: EscalationState, eventType: string, patch: Record<string, unknown> = {}, detail: Record<string, unknown> = {}) {
  assertEscalationTransition(escalation.state, to);
  const columns = Object.keys(patch);
  const assignments = ["state = ?", "updated_at = ?", "version = version + 1", ...columns.map((column) => `${column} = ?`)].join(", ");
  const result = await unit.tx.run(
    `UPDATE escalations SET ${assignments} WHERE tenant_id = ? AND id = ? AND version = ?`,
    [to, unit.now, ...columns.map((column) => patch[column]), escalation.tenant_id, escalation.id, escalation.version],
  );
  if (result.affectedRows !== 1) throw new DeskError("invalid_state", "The escalation changed while this action was running. Try again.");
  await unit.escalationEvent(escalation.tenant_id, escalation.id, eventType, escalation.state, to, detail);
  await unit.outbox(`escalation.${eventType}`, escalation.tenant_id, ext("esc", escalation.id), { escalation_id: ext("esc", escalation.id), from: escalation.state, to, ...detail });
  unit.audit({ tenantId: escalation.tenant_id, action: `escalation.${eventType}`, entityType: "escalation", entityId: ext("esc", escalation.id), before: { state: escalation.state }, after: { state: to, ...detail } });
  Object.assign(escalation, { state: to, version: escalation.version + 1 }, patch);
  return escalation;
}

export type HandlingRow = {
  tenant_id: Buffer; id: Buffer; escalation_id: Buffer; offer_id: Buffer | null; conversation_id: Buffer; line_id: Buffer; operator_id: Buffer; channel: HandlingChannel;
  state: HandlingState; muted: number; offered_at: Date; accepted_at: Date | null; connected_at: Date | null; hold_started_at: Date | null; hold_seconds: number;
  ended_at: Date | null; wrap_started_at: Date | null; wrap_due_at: Date | null; wrap_ended_at: Date | null; greeting_script_id: Buffer | null;
  greeting_script_version: number | null; greeting_delivered: number; disposition: string | null; transferred_to: string | null; version: number;
};

export async function lockHandling(tx: DeskTx, tenantId: Buffer, handlingId: Buffer) {
  const [row] = await tx.rows<HandlingRow>("SELECT * FROM desk_handlings WHERE tenant_id = ? AND id = ? FOR UPDATE", [tenantId, handlingId]);
  if (!row) throw new DeskError("not_found", "Interaction not found.", 404);
  return row;
}

export async function moveHandling(unit: Unit, handling: HandlingRow, to: HandlingState, eventType: string, patch: Record<string, unknown> = {}, detail: Record<string, unknown> = {}) {
  if (handling.state !== to) assertHandlingTransition(handling.state, to);
  const columns = Object.keys(patch);
  const assignments = ["state = ?", "version = version + 1", ...columns.map((column) => `${column} = ?`)].join(", ");
  const result = await unit.tx.run(
    `UPDATE desk_handlings SET ${assignments} WHERE tenant_id = ? AND id = ? AND version = ?`,
    [to, ...columns.map((column) => patch[column]), handling.tenant_id, handling.id, handling.version],
  );
  if (result.affectedRows !== 1) throw new DeskError("invalid_state", "The interaction changed while this action was running. Try again.");
  await unit.handlingEvent(handling.tenant_id, handling.id, eventType, { from: handling.state, to, ...detail }, handling.operator_id);
  unit.audit({ tenantId: handling.tenant_id, action: `handling.${eventType}`, entityType: "handling", entityId: ext("hdl", handling.id), before: { state: handling.state }, after: { state: to, ...detail } });
  Object.assign(handling, { state: to, version: handling.version + 1 }, patch);
  return handling;
}

// Recomputes presence from open handlings (DSK-014). Voice and callbacks make
// the operator busy; chats only consume chat capacity.
export async function refreshPresence(unit: Unit, operatorId: Buffer) {
  const [presence] = await unit.tx.rows<{ status: string }>("SELECT status FROM operator_presence WHERE operator_id = ? FOR UPDATE", [operatorId]);
  if (!presence) return;
  const [load] = await unit.tx.rows<{ live: number; wrapping: number }>(
    `SELECT COALESCE(SUM(state IN ('accepted','connecting','active','on_hold')), 0) AS live, COALESCE(SUM(state IN ('ended','wrap_up')), 0) AS wrapping
       FROM desk_handlings WHERE operator_id = ? AND channel IN ('voice','callback') AND state NOT IN ('completed','failed')`,
    [operatorId],
  );
  const live = Number(load?.live || 0);
  const wrapping = Number(load?.wrapping || 0);
  let next = presence.status;
  if (live > 0) next = "on_call";
  else if (wrapping > 0) next = "wrap_up";
  else if (presence.status === "on_call" || presence.status === "wrap_up") next = "available";
  if (next === presence.status) return;
  await unit.tx.run(
    "UPDATE operator_presence SET status = ?, status_since = ?, idle_since = IF(? = 'available', ?, idle_since), version = version + 1 WHERE operator_id = ?",
    [next, unit.now, next, unit.now, operatorId],
  );
  await unit.outbox("operator.presence_changed", null, ext("opr", operatorId), { operator_id: ext("opr", operatorId), from: presence.status, to: next });
}

// Ends a handling with a disposition, meters HITL minutes (BIL-004) and
// resolves the escalation. Idempotent metering through the usage key.
export async function completeHandling(unit: Unit, handling: HandlingRow, disposition: string, patch: Record<string, unknown> = {}, resolveEscalation = true) {
  const endedAt = handling.ended_at || unit.now;
  await moveHandling(unit, handling, "completed", "handling.completed", { disposition, ended_at: endedAt, wrap_ended_at: unit.now, ...patch }, { disposition });
  const talkSeconds = handling.connected_at ? Math.max(0, (endedAt.getTime() - handling.connected_at.getTime()) / 1000) : 0;
  const wrapSeconds = handling.wrap_started_at ? Math.max(0, (unit.now.getTime() - handling.wrap_started_at.getTime()) / 1000) : 0;
  const minutes = Math.round(((talkSeconds + wrapSeconds) / 60) * 1_000_000) / 1_000_000;
  await unit.tx.run(
    `INSERT INTO usage_events (tenant_id, id, meter, quantity, unit, occurred_at, source_type, source_id, idempotency_key)
     VALUES (?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id = id`,
    [handling.tenant_id, newId("use").bytes, "hitl_minutes", minutes.toFixed(6), "minute", unit.now, "desk_handling", handling.id, `handling:${ext("hdl", handling.id)}`],
  );
  await unit.outbox("handling.completed", handling.tenant_id, ext("hdl", handling.id), { handling_id: ext("hdl", handling.id), disposition, hitl_minutes: minutes });
  if (resolveEscalation) {
    const escalation = await lockEscalation(unit.tx, handling.tenant_id, handling.escalation_id);
    if (escalation.state === "acknowledged" || escalation.state === "in_progress") {
      await moveEscalation(unit, escalation, "resolved", "resolved", { resolution_code: disposition, resolved_at: unit.now });
    }
    await unit.tx.run("UPDATE conversations SET status = IF(status = 'with_human', 'ended', status), ended_at = COALESCE(ended_at, ?) WHERE tenant_id = ? AND id = ?", [unit.now, handling.tenant_id, handling.conversation_id]);
    await unit.tx.run("UPDATE tasks SET state = 'done', completed_at = ?, version = version + 1 WHERE tenant_id = ? AND escalation_id = ? AND kind = 'callback' AND state = 'in_progress'", [unit.now, handling.tenant_id, handling.escalation_id]);
  }
  await refreshPresence(unit, handling.operator_id);
}

// Returns an escalation to routing after a failure, a revocation or a
// wrong-client report. The previous operator is excluded by its offer history.
export async function requeueEscalation(unit: Unit, escalationId: Buffer, tenantId: Buffer, reason: string) {
  const escalation = await lockEscalation(unit.tx, tenantId, escalationId);
  if (!["acknowledged", "in_progress", "notified"].includes(escalation.state)) return;
  await moveEscalation(unit, escalation, "escalated", "escalated", { assigned_type: "pool", assigned_id: null }, { reason });
  await unit.tx.run("UPDATE conversations SET status = 'active' WHERE tenant_id = ? AND id = ? AND status = 'with_human'", [tenantId, escalation.conversation_id]);
}

// Message capture (HIL-003): the caller is promised a callback with a
// severity-based deadline and the escalation is acknowledged by the pool.
export async function captureMessage(unit: Unit, escalation: EscalationRow) {
  const [conversation] = await unit.tx.rows<{ contact_id: Buffer | null }>("SELECT contact_id FROM conversations WHERE tenant_id = ? AND id = ?", [escalation.tenant_id, escalation.conversation_id]);
  const task = newId("tsk");
  const dueAt = new Date(unit.now.getTime() + callbackDueSeconds[escalation.severity] * 1000);
  await unit.tx.run(
    `INSERT INTO tasks (tenant_id, id, kind, escalation_id, contact_id, title, notes, severity, due_at, state, created_by_type, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,'open','system',?)`,
    [escalation.tenant_id, task.bytes, "callback", escalation.id, conversation?.contact_id || null, "Promised callback", escalation.context_snapshot.summary || escalation.trigger_code, escalation.severity, dueAt, unit.now],
  );
  await unit.tx.run("UPDATE call_offers SET outcome = 'cancelled', responded_at = ? WHERE tenant_id = ? AND escalation_id = ? AND outcome = 'pending'", [unit.now, escalation.tenant_id, escalation.id]);
  await moveEscalation(unit, escalation, "acknowledged", "message_captured", { assigned_type: "pool", assigned_id: null, cascade_step: 3, acknowledged_at: unit.now }, { task_id: task.id, callback_due_at: dueAt.toISOString() });
  await unit.outbox("task.created", escalation.tenant_id, task.id, { task_id: task.id, kind: "callback", due_at: dueAt.toISOString() });
}
