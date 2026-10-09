import "server-only";
import type { AuthActor } from "@/features/auth/types";
import { withDeskConnection } from "@/lib/call-center-mysql";
import { authorityCapabilities, type AuthorityCapability, type CapturedField, type DeskCommand, type DeskCommandType } from "../types";
import { newId, toBinaryId } from "../ids";
import { authorityFor, DeskError, hoursModeFor, validateWrapUp, withinWindows, type WrapUpInput } from "../workflow";
import { simulationIntake } from "./simulation";
import { loadTenant, resolveGreeting, type EscalationRow } from "./context";
import { completeHandling, lockEscalation, lockHandling, moveEscalation, moveHandling, refreshPresence, requeueEscalation, type HandlingRow } from "./lifecycle";
import { assertGrant, assertLead, resolveOperator, type OperatorRow } from "./operators";
import { dispatchEscalation, runSweep } from "./routing";
import { createEscalation } from "./intake";
import { ext, runUnit, sameId, type Unit } from "./unit";

// Desk command intake (Appendix J). The server owns interaction state; every
// command is idempotent by its id, authorized against the operator's client
// grant, and rejected when it would cross the client lock (DSK-009).

const commandTypes: readonly DeskCommandType[] = [
  "session.start", "shift.start", "shift.end", "presence.set", "offer.accept", "offer.decline", "call.connected", "greeting.delivered", "call.hold", "call.resume",
  "call.mute", "call.transfer", "call.handback", "call.end", "chat.reply", "request.update", "authority.act", "callback.schedule", "callback.start",
  "wrongclient.report", "wrapup.submit", "approval.decide", "incident.acknowledge", "grant.upsert", "grant.revoke", "qa.submit", "simulate.inbound",
];

export function parseCommand(body: unknown): DeskCommand {
  const value = (body || {}) as Record<string, unknown>;
  if (!commandTypes.includes(value.type as DeskCommandType)) throw new DeskError("invalid_input", "Unknown desk command.", 400);
  if (typeof value.id !== "string" || !/^[A-Za-z0-9_-]{8,96}$/.test(value.id)) throw new DeskError("invalid_input", "Commands need an idempotency id.", 400);
  const payload = value.payload && typeof value.payload === "object" && !Array.isArray(value.payload) ? value.payload as Record<string, unknown> : {};
  return { type: value.type as DeskCommandType, id: value.id, payload };
}

const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
const operatorActor = (operator: OperatorRow) => ({ type: "operator" as const, id: ext("opr", operator.id) });

type Ctx = { unit: Unit; operator: OperatorRow; payload: Record<string, unknown>; sessionId: string };

async function lockOwnHandling(ctx: Ctx) {
  const handlingId = toBinaryId("hdl", ctx.payload.handling_id);
  const tenantId = toBinaryId("tnt", ctx.payload.tenant_id);
  const [located] = await ctx.unit.tx.rows<{ tenant_id: Buffer }>("SELECT tenant_id FROM desk_handlings WHERE id = ?", [handlingId]);
  if (!located) throw new DeskError("not_found", "Interaction not found.", 404);
  if (!sameId(located.tenant_id, tenantId)) {
    throw new DeskError("client_mismatch", "This action names a different client than the interaction. Nothing was changed.", 409);
  }
  const handling = await lockHandling(ctx.unit.tx, tenantId, handlingId);
  if (!sameId(handling.operator_id, ctx.operator.id)) throw new DeskError("forbidden", "This interaction belongs to another operator.", 403);
  await assertGrant(ctx.unit.tx, ctx.operator.id, tenantId, ctx.unit.now);
  return handling;
}

const isVoice = (handling: HandlingRow) => handling.channel === "voice" || handling.channel === "callback";

async function wrapUpDeadline(ctx: Ctx, tenantId: Buffer) {
  const [profile] = await ctx.unit.tx.rows<{ wrap_up_seconds: number }>("SELECT wrap_up_seconds FROM client_desk_profiles WHERE tenant_id = ?", [tenantId]);
  return new Date(ctx.unit.now.getTime() + (profile?.wrap_up_seconds || 60) * 1000);
}

async function enterWrapUp(ctx: Ctx, handling: HandlingRow, eventType: string, detail: Record<string, unknown> = {}, patch: Record<string, unknown> = {}) {
  if (handling.state === "wrap_up") return handling;
  const holdSeconds = handling.hold_started_at ? Math.round((ctx.unit.now.getTime() - handling.hold_started_at.getTime()) / 1000) : 0;
  await moveHandling(ctx.unit, handling, "wrap_up", eventType, {
    ended_at: ctx.unit.now, wrap_started_at: ctx.unit.now, wrap_due_at: await wrapUpDeadline(ctx, handling.tenant_id),
    hold_started_at: null, hold_seconds: handling.hold_seconds + holdSeconds, ...patch,
  }, detail);
  await refreshPresence(ctx.unit, ctx.operator.id);
  return handling;
}

async function voiceCapacity(ctx: Ctx) {
  const [load] = await ctx.unit.tx.rows<{ voice: number; chat: number }>(
    `SELECT COALESCE(SUM(channel IN ('voice','callback')), 0) AS voice, COALESCE(SUM(channel IN ('chat','sms')), 0) AS chat
       FROM desk_handlings WHERE operator_id = ? AND state NOT IN ('completed','failed')`,
    [ctx.operator.id],
  );
  return { voice: Number(load?.voice || 0), chat: Number(load?.chat || 0) };
}

async function greetingFor(ctx: Ctx, tenantId: Buffer, language: string, mode?: "callback") {
  const loaded = await loadTenant(ctx.unit.tx, tenantId);
  if (!loaded) throw new DeskError("not_found", "Client desk profile is missing.", 404);
  const hoursMode = mode || hoursModeFor(loaded.profile.business_facts.business_hours || [], loaded.tenant.time_zone, ctx.unit.now);
  return { script: await resolveGreeting(ctx.unit.tx, tenantId, language, hoursMode), loaded };
}

const handlers: Record<Exclude<DeskCommandType, "simulate.inbound">, (ctx: Ctx) => Promise<Record<string, unknown>>> = {
  async "session.start"(ctx) {
    // A new desk session supersedes the previous one (Appendix J).
    await ctx.unit.tx.run(
      `INSERT INTO operator_presence (operator_id, status, status_since, last_heartbeat_at, desk_session_id) VALUES (?, 'offline', ?, ?, ?)
       ON DUPLICATE KEY UPDATE desk_session_id = VALUES(desk_session_id), last_heartbeat_at = VALUES(last_heartbeat_at), version = version + 1`,
      [ctx.operator.id, ctx.unit.now, ctx.unit.now, ctx.sessionId],
    );
    ctx.unit.audit({ tenantId: null, action: "desk.session_started", entityType: "operator", entityId: ext("opr", ctx.operator.id), before: null, after: { session: ctx.sessionId } });
    return {};
  },

  async "shift.start"(ctx) {
    const checks = (ctx.payload.checks || {}) as Record<string, unknown>;
    if (checks.network !== true || checks.noticesAcknowledged !== true) throw new DeskError("invalid_input", "Complete the network check and acknowledge client notices before starting a shift.", 400);
    const [open] = await ctx.unit.tx.rows<{ id: Buffer }>("SELECT id FROM operator_shifts WHERE operator_id = ? AND ended_at IS NULL", [ctx.operator.id]);
    if (!open) {
      await ctx.unit.tx.run("INSERT INTO operator_shifts (id, operator_id, started_at, checks) VALUES (?,?,?,?)", [newId("shf").bytes, ctx.operator.id, ctx.unit.now, JSON.stringify({ microphone: checks.microphone === true, network: true, noticesAcknowledged: true })]);
    }
    await ctx.unit.tx.run("UPDATE operator_presence SET status = 'available', status_since = ?, idle_since = ?, missed_offers = 0, shift_checks = ?, version = version + 1 WHERE operator_id = ?", [ctx.unit.now, ctx.unit.now, JSON.stringify(checks), ctx.operator.id]);
    await ctx.unit.outbox("operator.presence_changed", null, ext("opr", ctx.operator.id), { operator_id: ext("opr", ctx.operator.id), to: "available", reason: "shift_started" });
    return {};
  },

  async "shift.end"(ctx) {
    const load = await voiceCapacity(ctx);
    if (load.voice || load.chat) throw new DeskError("invalid_state", "Finish your open interactions before ending the shift.");
    await ctx.unit.tx.run("UPDATE call_offers SET outcome = 'cancelled', responded_at = ? WHERE operator_id = ? AND outcome = 'pending'", [ctx.unit.now, ctx.operator.id]);
    await ctx.unit.tx.run("UPDATE operator_shifts SET ended_at = ? WHERE operator_id = ? AND ended_at IS NULL", [ctx.unit.now, ctx.operator.id]);
    await ctx.unit.tx.run("UPDATE operator_presence SET status = 'offline', status_since = ?, version = version + 1 WHERE operator_id = ?", [ctx.unit.now, ctx.operator.id]);
    await ctx.unit.outbox("operator.presence_changed", null, ext("opr", ctx.operator.id), { operator_id: ext("opr", ctx.operator.id), to: "offline", reason: "shift_ended" });
    return {};
  },

  async "presence.set"(ctx) {
    const status = ctx.payload.status;
    if (status !== "available" && status !== "away" && status !== "break") throw new DeskError("invalid_input", "Presence must be available, away or break.", 400);
    const [presence] = await ctx.unit.tx.rows<{ status: string }>("SELECT status FROM operator_presence WHERE operator_id = ? FOR UPDATE", [ctx.operator.id]);
    if (!presence || presence.status === "on_call" || presence.status === "wrap_up") throw new DeskError("invalid_state", "Presence changes after your current interaction and wrap-up.");
    if (status === "available") {
      const [shift] = await ctx.unit.tx.rows<{ id: Buffer }>("SELECT id FROM operator_shifts WHERE operator_id = ? AND ended_at IS NULL", [ctx.operator.id]);
      if (!shift) throw new DeskError("invalid_state", "Start your shift before becoming available.");
    } else {
      // Withdraw anything ringing so it reaches the next operator immediately.
      const pending = await ctx.unit.tx.rows<{ tenant_id: Buffer; escalation_id: Buffer }>("SELECT tenant_id, escalation_id FROM call_offers WHERE operator_id = ? AND outcome = 'pending' FOR UPDATE", [ctx.operator.id]);
      await ctx.unit.tx.run("UPDATE call_offers SET outcome = 'cancelled', responded_at = ? WHERE operator_id = ? AND outcome = 'pending'", [ctx.unit.now, ctx.operator.id]);
      await ctx.unit.tx.run("UPDATE operator_presence SET status = ?, status_since = ?, version = version + 1 WHERE operator_id = ?", [status, ctx.unit.now, ctx.operator.id]);
      for (const offer of pending) await dispatchEscalation(ctx.unit, await lockEscalation(ctx.unit.tx, offer.tenant_id, offer.escalation_id));
      await ctx.unit.outbox("operator.presence_changed", null, ext("opr", ctx.operator.id), { operator_id: ext("opr", ctx.operator.id), from: presence.status, to: status });
      return {};
    }
    await ctx.unit.tx.run("UPDATE operator_presence SET status = 'available', status_since = ?, idle_since = ?, missed_offers = 0, version = version + 1 WHERE operator_id = ?", [ctx.unit.now, ctx.unit.now, ctx.operator.id]);
    await ctx.unit.outbox("operator.presence_changed", null, ext("opr", ctx.operator.id), { operator_id: ext("opr", ctx.operator.id), from: presence.status, to: "available" });
    return {};
  },

  async "offer.accept"(ctx) {
    const offerId = toBinaryId("ofr", ctx.payload.offer_id);
    const tenantId = toBinaryId("tnt", ctx.payload.tenant_id);
    const [offer] = await ctx.unit.tx.rows<{ tenant_id: Buffer; id: Buffer; escalation_id: Buffer; operator_id: Buffer; outcome: string; expires_at: Date }>("SELECT * FROM call_offers WHERE id = ? FOR UPDATE", [offerId]);
    if (!offer) throw new DeskError("not_found", "Offer not found.", 404);
    if (!sameId(offer.tenant_id, tenantId)) throw new DeskError("client_mismatch", "The offer is for a different client than shown. Nothing was accepted.");
    if (!sameId(offer.operator_id, ctx.operator.id)) throw new DeskError("forbidden", "This offer was made to another operator.", 403);
    if (offer.outcome === "accepted") throw new DeskError("already_assigned", "This interaction was already accepted.");
    if (offer.outcome !== "pending" || offer.expires_at.getTime() <= ctx.unit.now.getTime()) throw new DeskError("offer_expired", "The offer expired and moved to the next operator.");
    await assertGrant(ctx.unit.tx, ctx.operator.id, tenantId, ctx.unit.now);
    const escalation: EscalationRow = await lockEscalation(ctx.unit.tx, tenantId, offer.escalation_id);
    const load = await voiceCapacity(ctx);
    if (escalation.channel === "voice" ? load.voice >= ctx.operator.max_voice : (load.chat >= ctx.operator.max_chat || load.voice > 0)) {
      throw new DeskError("capacity", "Finish your current interaction or wrap-up before accepting another.");
    }
    // Atomic compare-and-set: only one acceptance can win (§16.7.3).
    const won = await ctx.unit.tx.run("UPDATE call_offers SET outcome = 'accepted', responded_at = ? WHERE tenant_id = ? AND id = ? AND outcome = 'pending'", [ctx.unit.now, tenantId, offerId]);
    if (won.affectedRows !== 1) throw new DeskError("already_assigned", "This interaction was already accepted.");
    await moveEscalation(ctx.unit, escalation, "acknowledged", "acknowledged", { assigned_type: "operator", assigned_id: ctx.operator.id, acknowledged_at: ctx.unit.now }, { operator_id: ext("opr", ctx.operator.id) });
    const { script } = await greetingFor(ctx, tenantId, escalation.language);
    const handling = newId("hdl");
    const voice = escalation.channel === "voice";
    await ctx.unit.tx.run(
      `INSERT INTO desk_handlings (tenant_id, id, escalation_id, offer_id, conversation_id, line_id, operator_id, channel, state, offered_at, accepted_at, connected_at, greeting_script_id, greeting_script_version)
       SELECT ?, ?, ?, ?, e.conversation_id, e.line_id, ?, e.channel, ?, co.offered_at, ?, ?, ?, ? FROM escalations e JOIN call_offers co ON co.tenant_id = e.tenant_id AND co.id = ? WHERE e.tenant_id = ? AND e.id = ?`,
      [tenantId, handling.bytes, escalation.id, offerId, ctx.operator.id, voice ? "connecting" : "active", ctx.unit.now, voice ? null : ctx.unit.now, script?.id || null, script?.script_version ?? null, offerId, tenantId, escalation.id],
    );
    await ctx.unit.handlingEvent(tenantId, handling.bytes, "handling.started", { channel: escalation.channel, state: voice ? "connecting" : "active" }, ctx.operator.id);
    if (!voice) await moveEscalation(ctx.unit, escalation, "in_progress", "in_progress", {}, { takeover: true });
    await ctx.unit.tx.run("UPDATE operator_presence SET missed_offers = 0 WHERE operator_id = ?", [ctx.operator.id]);
    await refreshPresence(ctx.unit, ctx.operator.id);
    await ctx.unit.outbox("offer.accepted", tenantId, ext("ofr", offerId), { offer_id: ext("ofr", offerId), handling_id: handling.id, operator_id: ext("opr", ctx.operator.id) });
    await ctx.unit.outbox(voice ? "handling.started" : "takeover.started", tenantId, handling.id, { handling_id: handling.id, channel: escalation.channel });
    ctx.unit.audit({ tenantId, action: "offer.accepted", entityType: "handling", entityId: handling.id, before: null, after: { escalation_id: ext("esc", escalation.id), operator_id: ext("opr", ctx.operator.id) } });
    return { handling_id: handling.id };
  },

  async "offer.decline"(ctx) {
    const offerId = toBinaryId("ofr", ctx.payload.offer_id);
    const tenantId = toBinaryId("tnt", ctx.payload.tenant_id);
    const reason = text(ctx.payload.reason, 120) || "declined";
    const result = await ctx.unit.tx.run("UPDATE call_offers SET outcome = 'declined', decline_reason = ?, responded_at = ? WHERE tenant_id = ? AND id = ? AND operator_id = ? AND outcome = 'pending'", [reason, ctx.unit.now, tenantId, offerId, ctx.operator.id]);
    if (result.affectedRows !== 1) throw new DeskError("offer_expired", "The offer is no longer pending.");
    const [offer] = await ctx.unit.tx.rows<{ escalation_id: Buffer }>("SELECT escalation_id FROM call_offers WHERE tenant_id = ? AND id = ?", [tenantId, offerId]);
    await ctx.unit.escalationEvent(tenantId, offer.escalation_id, "offer.declined", null, null, { offer_id: ext("ofr", offerId), reason, operator_id: ext("opr", ctx.operator.id) });
    await ctx.unit.outbox("offer.declined", tenantId, ext("ofr", offerId), { offer_id: ext("ofr", offerId), reason });
    await dispatchEscalation(ctx.unit, await lockEscalation(ctx.unit.tx, tenantId, offer.escalation_id));
    return {};
  },

  async "call.connected"(ctx) {
    const handling = await lockOwnHandling(ctx);
    if (handling.state !== "connecting") return { state: handling.state };
    await moveHandling(ctx.unit, handling, "active", "call.connected", { connected_at: ctx.unit.now });
    const escalation = await lockEscalation(ctx.unit.tx, handling.tenant_id, handling.escalation_id);
    if (escalation.state === "acknowledged") await moveEscalation(ctx.unit, escalation, "in_progress", "in_progress");
    return {};
  },

  async "greeting.delivered"(ctx) {
    const handling = await lockOwnHandling(ctx);
    if (handling.greeting_delivered) return {};
    await ctx.unit.tx.run("UPDATE desk_handlings SET greeting_delivered = 1, version = version + 1 WHERE tenant_id = ? AND id = ?", [handling.tenant_id, handling.id]);
    await ctx.unit.handlingEvent(handling.tenant_id, handling.id, "greeting.delivered", { script_version: handling.greeting_script_version }, ctx.operator.id);
    return {};
  },

  async "call.hold"(ctx) {
    const handling = await lockOwnHandling(ctx);
    if (!isVoice(handling)) throw new DeskError("invalid_state", "Hold applies to calls only.");
    await moveHandling(ctx.unit, handling, "on_hold", "call.hold", { hold_started_at: ctx.unit.now });
    return {};
  },

  async "call.resume"(ctx) {
    const handling = await lockOwnHandling(ctx);
    const held = handling.hold_started_at ? Math.round((ctx.unit.now.getTime() - handling.hold_started_at.getTime()) / 1000) : 0;
    await moveHandling(ctx.unit, handling, "active", "call.resume", { hold_started_at: null, hold_seconds: handling.hold_seconds + held });
    return {};
  },

  async "call.mute"(ctx) {
    const handling = await lockOwnHandling(ctx);
    const muted = ctx.payload.muted === true;
    await ctx.unit.tx.run("UPDATE desk_handlings SET muted = ?, version = version + 1 WHERE tenant_id = ? AND id = ?", [muted, handling.tenant_id, handling.id]);
    await ctx.unit.handlingEvent(handling.tenant_id, handling.id, muted ? "call.muted" : "call.unmuted", {}, ctx.operator.id);
    return {};
  },

  async "call.transfer"(ctx) {
    const handling = await lockOwnHandling(ctx);
    if (!isVoice(handling) || !["active", "on_hold"].includes(handling.state)) throw new DeskError("invalid_state", "Only a connected call can be transferred.");
    const targetId = toBinaryId("xfr", ctx.payload.contact_id);
    // (tenant_id, id) lookup: a contact of another client cannot be found.
    const [target] = await ctx.unit.tx.rows<{ name: string; role_label: string }>("SELECT name, role_label FROM client_transfer_contacts WHERE tenant_id = ? AND id = ?", [handling.tenant_id, targetId]);
    if (!target) throw new DeskError("client_mismatch", "That transfer contact does not belong to this client.");
    const mode = ctx.payload.mode === "cold" ? "cold" : "warm";
    const briefing = text(ctx.payload.briefing, 600);
    if (mode === "warm" && !briefing) throw new DeskError("invalid_input", "A warm transfer needs a briefing.", 400);
    await enterWrapUp(ctx, handling, "call.transferred", { mode, target: target.name, role: target.role_label, briefing }, { transferred_to: ext("xfr", targetId) });
    await ctx.unit.outbox("call.transferred", handling.tenant_id, ext("hdl", handling.id), { handling_id: ext("hdl", handling.id), mode, target_contact_id: ext("xfr", targetId) });
    return {};
  },

  async "call.handback"(ctx) {
    const handling = await lockOwnHandling(ctx);
    const instruction = text(ctx.payload.instruction, 600);
    if (!instruction) throw new DeskError("invalid_input", "Tell the AI how to continue.", 400);
    await ctx.unit.tx.run("INSERT INTO messages (tenant_id, id, conversation_id, speaker, operator_id, body, occurred_at) VALUES (?,?,?,?,?,?,?)", [handling.tenant_id, newId("msg").bytes, handling.conversation_id, "system", ctx.operator.id, `Operator instruction to AI: ${instruction}`, ctx.unit.now]);
    await ctx.unit.tx.run("UPDATE conversations SET status = 'active' WHERE tenant_id = ? AND id = ?", [handling.tenant_id, handling.conversation_id]);
    await enterWrapUp(ctx, handling, "call.handback", { instruction });
    await ctx.unit.outbox("takeover.ended", handling.tenant_id, ext("hdl", handling.id), { handling_id: ext("hdl", handling.id), instruction });
    return {};
  },

  async "call.end"(ctx) {
    const handling = await lockOwnHandling(ctx);
    if (!["connecting", "active", "on_hold"].includes(handling.state)) throw new DeskError("invalid_state", "This interaction already ended.");
    await enterWrapUp(ctx, handling, isVoice(handling) ? "call.ended" : "chat.released");
    if (!isVoice(handling)) await ctx.unit.outbox("takeover.ended", handling.tenant_id, ext("hdl", handling.id), { handling_id: ext("hdl", handling.id) });
    return {};
  },

  async "chat.reply"(ctx) {
    const handling = await lockOwnHandling(ctx);
    if (isVoice(handling) || handling.state !== "active") throw new DeskError("invalid_state", "Replies need an active chat or text thread.");
    const body = text(ctx.payload.text, 2000);
    if (!body) throw new DeskError("invalid_input", "Write a reply first.", 400);
    const message = newId("msg");
    await ctx.unit.tx.run("INSERT INTO messages (tenant_id, id, conversation_id, speaker, operator_id, body, occurred_at) VALUES (?,?,?,?,?,?,?)", [handling.tenant_id, message.bytes, handling.conversation_id, "operator", ctx.operator.id, body, ctx.unit.now]);
    await ctx.unit.outbox("message.sent", handling.tenant_id, message.id, { conversation_id: ext("cnv", handling.conversation_id), handling_id: ext("hdl", handling.id) });
    return { message_id: message.id };
  },

  async "request.update"(ctx) {
    const handling = await lockOwnHandling(ctx);
    const requestId = toBinaryId("req", ctx.payload.request_id);
    const [request] = await ctx.unit.tx.rows<{ version: number; captured_fields: CapturedField[]; urgency: string; service_type: string | null; summary: string | null }>(
      "SELECT version, captured_fields, urgency, service_type, summary FROM requests WHERE tenant_id = ? AND id = ? AND conversation_id = ? FOR UPDATE",
      [handling.tenant_id, requestId, handling.conversation_id],
    );
    if (!request) throw new DeskError("client_mismatch", "That request does not belong to this interaction.");
    if (Number(ctx.payload.version) !== request.version) throw new DeskError("invalid_state", "The request changed since you opened it. Review the latest version.");
    const loaded = await loadTenant(ctx.unit.tx, handling.tenant_id);
    const editable = new Set([...(loaded?.profile.visible_fields || []), ...(loaded?.profile.playbook_slots || []).map((slot) => slot.field)]);
    const fields = [...request.captured_fields];
    for (const change of Array.isArray(ctx.payload.fields) ? ctx.payload.fields as Array<Record<string, unknown>> : []) {
      const field = text(change.field, 48);
      if (!field || (!editable.has(field) && !editable.has("*"))) throw new DeskError("forbidden", `The field ${field || "(blank)"} is not editable for this client.`, 403);
      const value = change.value === null ? null : text(change.value, 300);
      const index = fields.findIndex((item) => item.field === field);
      const slot = loaded?.profile.playbook_slots.find((item) => item.field === field);
      const next = { field, label: slot?.label || fields[index]?.label, value, confidence: 1, confirmed: change.confirmed !== false };
      if (index >= 0) fields[index] = next; else fields.push(next);
    }
    const urgency = (["emergency", "urgent", "standard", "info"] as const).find((item) => item === ctx.payload.urgency) || request.urgency;
    const serviceType = ctx.payload.service_type === undefined ? request.service_type : text(ctx.payload.service_type, 80) || null;
    const summary = ctx.payload.summary === undefined ? request.summary : text(ctx.payload.summary, 1000) || null;
    await ctx.unit.tx.run(
      "UPDATE requests SET captured_fields = ?, urgency = ?, service_type = ?, summary = ?, updated_at = ?, version = version + 1 WHERE tenant_id = ? AND id = ? AND version = ?",
      [JSON.stringify(fields), urgency, serviceType, summary, ctx.unit.now, handling.tenant_id, requestId, request.version],
    );
    await ctx.unit.handlingEvent(handling.tenant_id, handling.id, "request.updated", { request_id: ext("req", requestId), fields: fields.length }, ctx.operator.id);
    await ctx.unit.outbox("request.updated", handling.tenant_id, ext("req", requestId), { request_id: ext("req", requestId), version: request.version + 1 });
    ctx.unit.audit({ tenantId: handling.tenant_id, action: "request.updated", entityType: "request", entityId: ext("req", requestId), before: { fields: request.captured_fields, urgency: request.urgency }, after: { fields, urgency } });
    return { version: request.version + 1 };
  },

  async "authority.act"(ctx) {
    const handling = await lockOwnHandling(ctx);
    const capability = ctx.payload.capability as AuthorityCapability;
    if (!authorityCapabilities.some(([key]) => key === capability)) throw new DeskError("invalid_input", "Unknown capability.", 400);
    const detail = text(ctx.payload.detail, 600);
    if (!detail) throw new DeskError("invalid_input", "Describe what you are doing for the caller.", 400);
    const loaded = await loadTenant(ctx.unit.tx, handling.tenant_id);
    const level = authorityFor(loaded?.profile.authority_matrix || {}, capability);
    if (level === "not_allowed") {
      await ctx.unit.handlingEvent(handling.tenant_id, handling.id, "authority.denied", { capability }, ctx.operator.id);
      throw new DeskError("authority_denied", "This client does not allow operators to do that. Offer to take a message for the owner.", 403);
    }
    if (level === "allowed") {
      await ctx.unit.handlingEvent(handling.tenant_id, handling.id, "authority.used", { capability, detail }, ctx.operator.id);
      ctx.unit.audit({ tenantId: handling.tenant_id, action: "authority.used", entityType: "handling", entityId: ext("hdl", handling.id), before: null, after: { capability, detail } });
      return { outcome: "done" };
    }
    const approval = newId("apr");
    await ctx.unit.tx.run(
      "INSERT INTO approvals (tenant_id, id, escalation_id, handling_id, capability, request_detail, state, requested_by, created_at) VALUES (?,?,?,?,?,?, 'pending', ?, ?)",
      [handling.tenant_id, approval.bytes, handling.escalation_id, handling.id, capability, detail, ctx.operator.id, ctx.unit.now],
    );
    await ctx.unit.outbox("approval.requested", handling.tenant_id, approval.id, { approval_id: approval.id, capability });
    ctx.unit.audit({ tenantId: handling.tenant_id, action: "approval.requested", entityType: "approval", entityId: approval.id, before: null, after: { capability, detail } });
    return { outcome: "approval_requested", approval_id: approval.id };
  },

  async "callback.schedule"(ctx) {
    const handling = await lockOwnHandling(ctx);
    const dueAt = new Date(String(ctx.payload.due_at || ""));
    if (Number.isNaN(dueAt.getTime()) || dueAt.getTime() < ctx.unit.now.getTime()) throw new DeskError("invalid_input", "Choose a callback time in the future.", 400);
    const task = newId("tsk");
    const [conversation] = await ctx.unit.tx.rows<{ contact_id: Buffer | null }>("SELECT contact_id FROM conversations WHERE tenant_id = ? AND id = ?", [handling.tenant_id, handling.conversation_id]);
    const [escalation] = await ctx.unit.tx.rows<{ severity: number }>("SELECT severity FROM escalations WHERE tenant_id = ? AND id = ?", [handling.tenant_id, handling.escalation_id]);
    await ctx.unit.tx.run(
      "INSERT INTO tasks (tenant_id, id, kind, escalation_id, contact_id, title, notes, severity, due_at, created_by_type, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?, 'operator', ?, ?)",
      [handling.tenant_id, task.bytes, "follow_up", handling.escalation_id, conversation?.contact_id || null, "Scheduled callback", text(ctx.payload.notes, 1000) || null, escalation?.severity || 3, dueAt, ext("opr", ctx.operator.id), ctx.unit.now],
    );
    await ctx.unit.handlingEvent(handling.tenant_id, handling.id, "callback.scheduled", { task_id: task.id, due_at: dueAt.toISOString() }, ctx.operator.id);
    await ctx.unit.outbox("task.created", handling.tenant_id, task.id, { task_id: task.id, kind: "follow_up", due_at: dueAt.toISOString() });
    return { task_id: task.id };
  },

  async "callback.start"(ctx) {
    const tenantId = toBinaryId("tnt", ctx.payload.tenant_id);
    const taskId = toBinaryId("tsk", ctx.payload.task_id);
    await assertGrant(ctx.unit.tx, ctx.operator.id, tenantId, ctx.unit.now);
    const [task] = await ctx.unit.tx.rows<{ escalation_id: Buffer | null; state: string }>("SELECT escalation_id, state FROM tasks WHERE tenant_id = ? AND id = ? AND kind = 'callback' FOR UPDATE", [tenantId, taskId]);
    if (!task || !task.escalation_id) throw new DeskError("not_found", "Callback task not found.", 404);
    if (task.state !== "open") throw new DeskError("already_assigned", "Another operator already started this callback.");
    const load = await voiceCapacity(ctx);
    if (load.voice >= ctx.operator.max_voice) throw new DeskError("capacity", "Finish your current call and wrap-up first.");
    const escalation = await lockEscalation(ctx.unit.tx, tenantId, task.escalation_id);
    // Callbacks honor the client's calling-hour window in the client's zone (DSK-016).
    const { script, loaded } = await greetingFor(ctx, tenantId, escalation.language, "callback");
    if (!withinWindows([{ days: [0, 1, 2, 3, 4, 5, 6], start: "08:00", end: "21:00" }], loaded.tenant.time_zone, ctx.unit.now)) {
      throw new DeskError("invalid_state", "Outside calling hours (8 AM to 9 PM in the client's time zone). Leave the callback open.");
    }
    await ctx.unit.tx.run("UPDATE tasks SET state = 'in_progress', claimed_by = ?, version = version + 1 WHERE tenant_id = ? AND id = ?", [ctx.operator.id, tenantId, taskId]);
    const handling = newId("hdl");
    await ctx.unit.tx.run(
      `INSERT INTO desk_handlings (tenant_id, id, escalation_id, conversation_id, line_id, operator_id, channel, state, offered_at, accepted_at, greeting_script_id, greeting_script_version)
       VALUES (?,?,?,?,?,?, 'callback', 'connecting', ?, ?, ?, ?)`,
      [tenantId, handling.bytes, escalation.id, escalation.conversation_id, escalation.line_id, ctx.operator.id, ctx.unit.now, ctx.unit.now, script?.id || null, script?.script_version ?? null],
    );
    const [line] = await ctx.unit.tx.rows<{ e164: string | null }>("SELECT pn.e164 FROM channel_endpoints ce LEFT JOIN phone_numbers pn ON pn.tenant_id = ce.tenant_id AND pn.id = ce.phone_number_id WHERE ce.tenant_id = ? AND ce.id = ?", [tenantId, escalation.line_id]);
    await ctx.unit.handlingEvent(tenantId, handling.bytes, "callback.started", { task_id: ext("tsk", taskId), caller_id: line?.e164 || null }, ctx.operator.id);
    await refreshPresence(ctx.unit, ctx.operator.id);
    await ctx.unit.outbox("handling.started", tenantId, handling.id, { handling_id: handling.id, channel: "callback", caller_id: line?.e164 || null });
    return { handling_id: handling.id };
  },

  async "wrongclient.report"(ctx) {
    const handling = await lockOwnHandling(ctx);
    const incident = newId("wci");
    const notes = text(ctx.payload.notes, 600) || null;
    await ctx.unit.tx.run("INSERT INTO wrong_client_incidents (tenant_id, id, handling_id, operator_id, source, notes, created_at) VALUES (?,?,?,?, 'operator', ?, ?)", [handling.tenant_id, incident.bytes, handling.id, ctx.operator.id, notes, ctx.unit.now]);
    await completeHandling(ctx.unit, handling, "wrong_client", { wrong_client_flag: 1, operator_notes: notes }, false);
    await requeueEscalation(ctx.unit, handling.escalation_id, handling.tenant_id, "wrong_client");
    await dispatchEscalation(ctx.unit, await lockEscalation(ctx.unit.tx, handling.tenant_id, handling.escalation_id));
    await ctx.unit.outbox("wrongclient.reported", handling.tenant_id, incident.id, { incident_id: incident.id, handling_id: ext("hdl", handling.id) });
    ctx.unit.audit({ tenantId: handling.tenant_id, action: "wrongclient.reported", entityType: "handling", entityId: ext("hdl", handling.id), before: null, after: { incident_id: incident.id } });
    return { incident_id: incident.id };
  },

  async "wrapup.submit"(ctx) {
    const handling = await lockOwnHandling(ctx);
    if (!["wrap_up", "active", "on_hold", "connecting"].includes(handling.state)) throw new DeskError("invalid_state", "This interaction is already complete.");
    const loaded = await loadTenant(ctx.unit.tx, handling.tenant_id);
    const input: Partial<WrapUpInput> = {
      disposition: ctx.payload.disposition as WrapUpInput["disposition"],
      operatorNotes: text(ctx.payload.operator_notes, 2000), clientNotes: text(ctx.payload.client_notes, 2000),
      followUp: ctx.payload.follow_up && typeof ctx.payload.follow_up === "object" ? { dueAt: text((ctx.payload.follow_up as Record<string, unknown>).due_at, 40), notes: text((ctx.payload.follow_up as Record<string, unknown>).notes, 1000) } : null,
    };
    const errors = validateWrapUp(input, loaded?.profile.required_wrap_fields || []);
    if (errors.length) throw new DeskError("invalid_input", errors.join(" "), 400);
    if (handling.state !== "wrap_up") await enterWrapUp(ctx, handling, isVoice(handling) ? "call.ended" : "chat.released");
    if (input.followUp?.dueAt) {
      const task = newId("tsk");
      await ctx.unit.tx.run(
        "INSERT INTO tasks (tenant_id, id, kind, escalation_id, title, notes, severity, due_at, created_by_type, created_by, created_at) VALUES (?,?,?,?,?,?,3,?, 'operator', ?, ?)",
        [handling.tenant_id, task.bytes, input.disposition === "callback_scheduled" ? "callback" : "follow_up", handling.escalation_id, input.disposition === "callback_scheduled" ? "Scheduled callback" : "Follow-up", input.followUp.notes || null, new Date(input.followUp.dueAt), ext("opr", ctx.operator.id), ctx.unit.now],
      );
    }
    await completeHandling(ctx.unit, handling, input.disposition!, { operator_notes: input.operatorNotes || null, client_notes: input.clientNotes || null });
    // Client visibility (DSK-023): the summary is an outbox event the inbox consumes.
    await ctx.unit.outbox("handling.client_summary", handling.tenant_id, ext("hdl", handling.id), {
      handling_id: ext("hdl", handling.id), handled_by: ctx.operator.first_name, disposition: input.disposition, notes: input.clientNotes || null,
    });
    return {};
  },

  async "approval.decide"(ctx) {
    assertLead(ctx.operator);
    const tenantId = toBinaryId("tnt", ctx.payload.tenant_id);
    const approvalId = toBinaryId("apr", ctx.payload.approval_id);
    const decision = ctx.payload.decision === "approved" ? "approved" : ctx.payload.decision === "rejected" ? "rejected" : null;
    if (!decision) throw new DeskError("invalid_input", "Decision must be approved or rejected.", 400);
    const note = text(ctx.payload.note, 600);
    if (!note) throw new DeskError("invalid_input", "Record who approved on the owner's behalf and why.", 400);
    const result = await ctx.unit.tx.run(
      "UPDATE approvals SET state = ?, decided_by_type = 'operator_lead', decided_by = ?, decision_note = ?, decided_at = ? WHERE tenant_id = ? AND id = ? AND state = 'pending'",
      [decision, ext("opr", ctx.operator.id), note, ctx.unit.now, tenantId, approvalId],
    );
    if (result.affectedRows !== 1) throw new DeskError("invalid_state", "This approval was already decided.");
    await ctx.unit.outbox("approval.decided", tenantId, ext("apr", approvalId), { approval_id: ext("apr", approvalId), decision });
    ctx.unit.audit({ tenantId, action: "approval.decided", entityType: "approval", entityId: ext("apr", approvalId), before: { state: "pending" }, after: { state: decision, note } });
    return {};
  },

  async "incident.acknowledge"(ctx) {
    const incidentId = toBinaryId("uli", ctx.payload.incident_id);
    const result = await ctx.unit.tx.run("UPDATE unresolved_line_incidents SET state = 'acknowledged', acknowledged_by = ?, acknowledged_at = ? WHERE id = ? AND state = 'open'", [ctx.operator.id, ctx.unit.now, incidentId]);
    if (result.affectedRows !== 1) throw new DeskError("invalid_state", "This incident was already acknowledged.");
    ctx.unit.audit({ tenantId: null, action: "unknown_line.acknowledged", entityType: "unresolved_line", entityId: ext("uli", incidentId), before: { state: "open" }, after: { state: "acknowledged" } });
    return {};
  },

  async "grant.upsert"(ctx) {
    assertLead(ctx.operator);
    const operatorId = toBinaryId("opr", ctx.payload.operator_id);
    const tenantId = toBinaryId("tnt", ctx.payload.tenant_id);
    const skills = Array.isArray(ctx.payload.skills) ? (ctx.payload.skills as unknown[]).map((skill) => text(skill, 32)).filter(Boolean).slice(0, 12) : [];
    const trained = ctx.payload.training_completed === true;
    const certify = ctx.payload.certify === true;
    if (certify && !trained) throw new DeskError("invalid_input", "Record client-specific training before certifying (BRL-019).", 400);
    const expiresAt = ctx.payload.expires_at ? new Date(String(ctx.payload.expires_at)) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new DeskError("invalid_input", "Invalid expiry.", 400);
    const [before] = await ctx.unit.tx.rows<{ skills: string[]; training_completed_at: Date | null; certified_at: Date | null; revoked_at: Date | null }>("SELECT skills, training_completed_at, certified_at, revoked_at FROM operator_client_grants WHERE operator_id = ? AND tenant_id = ? FOR UPDATE", [operatorId, tenantId]);
    await ctx.unit.tx.run(
      `INSERT INTO operator_client_grants (operator_id, tenant_id, skills, training_completed_at, certified_at, granted_by, granted_at, expires_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE skills = VALUES(skills),
         training_completed_at = IF(?, COALESCE(training_completed_at, VALUES(training_completed_at)), NULL),
         certified_at = IF(?, COALESCE(certified_at, VALUES(certified_at)), NULL),
         granted_by = VALUES(granted_by), expires_at = VALUES(expires_at), revoked_at = NULL, revoked_by = NULL, version = version + 1`,
      [operatorId, tenantId, JSON.stringify(skills), trained ? ctx.unit.now : null, certify ? ctx.unit.now : null, ctx.operator.id, ctx.unit.now, expiresAt, trained, certify],
    );
    await ctx.unit.outbox("grant.changed", tenantId, ext("opr", operatorId), { operator_id: ext("opr", operatorId), certified: certify, skills });
    ctx.unit.audit({ tenantId, action: "grant.changed", entityType: "operator_grant", entityId: ext("opr", operatorId), before: before || null, after: { skills, trained, certified: certify, expires_at: expiresAt?.toISOString() || null } });
    return {};
  },

  async "grant.revoke"(ctx) {
    assertLead(ctx.operator);
    const operatorId = toBinaryId("opr", ctx.payload.operator_id);
    const tenantId = toBinaryId("tnt", ctx.payload.tenant_id);
    const result = await ctx.unit.tx.run("UPDATE operator_client_grants SET revoked_at = ?, revoked_by = ?, version = version + 1 WHERE operator_id = ? AND tenant_id = ? AND revoked_at IS NULL", [ctx.unit.now, ctx.operator.id, operatorId, tenantId]);
    if (result.affectedRows !== 1) throw new DeskError("invalid_state", "There is no active grant to revoke.");
    await ctx.unit.tx.run("UPDATE call_offers SET outcome = 'cancelled', responded_at = ? WHERE operator_id = ? AND tenant_id = ? AND outcome = 'pending'", [ctx.unit.now, operatorId, tenantId]);
    // Take effect for open interactions immediately (DSK-002): live work is
    // re-routed, wrap-ups are released.
    const open = await ctx.unit.tx.rows<HandlingRow>("SELECT * FROM desk_handlings WHERE operator_id = ? AND tenant_id = ? AND state NOT IN ('completed','failed') FOR UPDATE", [operatorId, tenantId]);
    for (const handling of open) {
      if (handling.state === "wrap_up" || handling.state === "ended") await completeHandling(ctx.unit, handling, "auto_released");
      else {
        await moveHandling(ctx.unit, handling, "failed", "handling.failed", { ended_at: ctx.unit.now }, { reason: "grant_revoked" });
        await requeueEscalation(ctx.unit, handling.escalation_id, tenantId, "grant_revoked");
        await refreshPresence(ctx.unit, operatorId);
      }
    }
    await ctx.unit.outbox("grant.changed", tenantId, ext("opr", operatorId), { operator_id: ext("opr", operatorId), revoked: true });
    ctx.unit.audit({ tenantId, action: "grant.revoked", entityType: "operator_grant", entityId: ext("opr", operatorId), before: { active: true }, after: { active: false, moved_out: open.length } });
    return { moved_out: open.length };
  },

  async "qa.submit"(ctx) {
    assertLead(ctx.operator);
    const tenantId = toBinaryId("tnt", ctx.payload.tenant_id);
    const handlingId = toBinaryId("hdl", ctx.payload.handling_id);
    const handling = await lockHandling(ctx.unit.tx, tenantId, handlingId);
    if (handling.state !== "completed") throw new DeskError("invalid_state", "Only completed interactions can be reviewed.");
    const raw = (ctx.payload.scores || {}) as Record<string, unknown>;
    const scores = Object.fromEntries(["accuracy", "safety", "tone", "outcome"].map((key) => [key, Math.min(5, Math.max(1, Math.round(Number(raw[key]) || 0)))]));
    const overall = Math.round((scores.accuracy + scores.safety + scores.tone + scores.outcome) / 4);
    const review = newId("qar");
    await ctx.unit.tx.run(
      "INSERT INTO qa_reviews (tenant_id, id, handling_id, reviewer_id, scores, greeting_correct, overall, notes, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [tenantId, review.bytes, handlingId, ctx.operator.id, JSON.stringify(scores), ctx.payload.greeting_correct === true, overall, text(ctx.payload.notes, 1000) || null, ctx.unit.now],
    );
    if (ctx.payload.wrong_client === true && !handling.disposition?.startsWith("wrong")) {
      await ctx.unit.tx.run("INSERT INTO wrong_client_incidents (tenant_id, id, handling_id, operator_id, source, notes, created_at) VALUES (?,?,?,?, 'quality_review', ?, ?)", [tenantId, newId("wci").bytes, handlingId, handling.operator_id, text(ctx.payload.notes, 600) || null, ctx.unit.now]);
      await ctx.unit.tx.run("UPDATE desk_handlings SET wrong_client_flag = 1, version = version + 1 WHERE tenant_id = ? AND id = ?", [tenantId, handlingId]);
    }
    const escalation = await lockEscalation(ctx.unit.tx, tenantId, handling.escalation_id);
    if (escalation.state === "resolved" || escalation.state === "auto_resolved") await moveEscalation(ctx.unit, escalation, "reviewed", "reviewed", {}, { qa_review_id: review.id, overall });
    await ctx.unit.outbox("qa_review.completed", tenantId, review.id, { qa_review_id: review.id, handling_id: ext("hdl", handlingId), overall });
    return { qa_review_id: review.id };
  },
};

export async function executeCommand(actor: AuthActor, command: DeskCommand, sessionId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) throw new DeskError("invalid_input", "A desk session id is required.", 400);
  if (command.type === "simulate.inbound") return simulateInbound(actor, command);
  const type: Exclude<DeskCommandType, "simulate.inbound"> = command.type;
  const result = await runUnit({ type: "operator", id: null }, async (unit) => {
    const operator = await resolveOperator(unit.tx, actor);
    if (!operator) throw new DeskError("forbidden", "Your account is not an active EverOnn operator.", 403);
    unit.actor.id = operatorActor(operator).id;
    const scope = ext("opr", operator.id);
    const [previous] = await unit.tx.rows<{ command: string; response: Record<string, unknown> }>("SELECT command, response FROM idempotency_keys WHERE scope = ? AND idem_key = ?", [scope, command.id]);
    if (previous) {
      if (previous.command !== type) throw new DeskError("invalid_input", "This idempotency id was used for a different command.", 400);
      return previous.response;
    }
    if (type !== "session.start") {
      const [presence] = await unit.tx.rows<{ desk_session_id: string | null }>("SELECT desk_session_id FROM operator_presence WHERE operator_id = ?", [operator.id]);
      if (presence?.desk_session_id && presence.desk_session_id !== sessionId) throw new DeskError("session_superseded", "This desk was opened in another window. Reload to take over here.");
    }
    const response = await handlers[type]({ unit, operator, payload: command.payload, sessionId });
    await unit.tx.run("INSERT INTO idempotency_keys (scope, idem_key, command, response, created_at) VALUES (?,?,?,?,?)", [scope, command.id, type, JSON.stringify(response), unit.now]);
    return response;
  });
  // Advance timers and routing right away so the next snapshot is current.
  await runSweep(true).catch(() => undefined);
  return result;
}

// Demonstration intake for leads while telephony is not connected. It goes
// through the same intake path the AI runtime uses.
async function simulateInbound(actor: AuthActor, command: DeskCommand) {
  const { operator, intake } = await withDeskConnection(async (tx) => {
    const operator = await resolveOperator(tx, actor);
    if (!operator) throw new DeskError("forbidden", "Your account is not an active EverOnn operator.", 403);
    assertLead(operator);
    const intake = await simulationIntake(tx, command.payload);
    return { operator, intake };
  });
  const result = await createEscalation({ type: "operator", id: ext("opr", operator.id) }, intake);
  await runSweep(true).catch(() => undefined);
  return result;
}
