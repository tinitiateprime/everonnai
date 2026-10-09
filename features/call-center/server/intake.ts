import "server-only";
import type { CapturedField, Channel, Severity } from "../types";
import { newId, toBinaryId } from "../ids";
import { DeskError, normalizeE164, slaDueAt } from "../workflow";
import { lockEscalation, moveEscalation, moveHandling, refreshPresence, type HandlingRow } from "./lifecycle";
import { dispatchEscalation } from "./routing";
import type { EscalationRow } from "./context";
import { ext, runUnit, type DeskActor, type Unit } from "./unit";

// Escalation intake (BP-2, HIL-001, DSK-003). The AI runtime calls this when
// a trigger fires; the dialed line is resolved to exactly one client or the
// interaction becomes an UNKNOWN LINE incident — the client is never guessed.

export type EscalationIntake = {
  channel: Channel;
  dialedE164?: string | null;
  widgetKey?: string | null;
  signaling?: { to?: string; diversion?: string[]; historyInfo?: string[] } | null;
  caller: { e164?: string | null; name?: string | null; language?: string | null };
  triggerCode: string;
  triggerDetail?: string | null;
  severity: Severity;
  aiSummary?: string | null;
  serviceType?: string | null;
  serviceLabel?: string | null;
  urgency?: "emergency" | "urgent" | "standard" | "info";
  captured?: CapturedField[];
  transcript?: Array<{ speaker: "caller" | "ai"; text: string }>;
};

const languages = new Set(["en", "es"]);

function parseIntake(input: unknown): EscalationIntake {
  const value = (input || {}) as Record<string, unknown>;
  const channel = value.channel;
  if (channel !== "voice" && channel !== "chat" && channel !== "sms") throw new DeskError("invalid_input", "channel must be voice, chat or sms.", 400);
  const severity = Number(value.severity);
  if (![1, 2, 3, 4].includes(severity)) throw new DeskError("invalid_input", "severity must be 1 to 4.", 400);
  const triggerCode = String(value.triggerCode || "").trim();
  if (!/^[a-z0-9_]{2,48}$/.test(triggerCode)) throw new DeskError("invalid_input", "triggerCode must be a snake_case code.", 400);
  const caller = (value.caller || {}) as EscalationIntake["caller"];
  const captured = Array.isArray(value.captured) ? (value.captured as CapturedField[]).slice(0, 40).map((field) => ({
    field: String(field.field).slice(0, 48), label: field.label ? String(field.label).slice(0, 80) : undefined, value: field.value === null ? null : String(field.value).slice(0, 300),
    confidence: Math.min(1, Math.max(0, Number(field.confidence) || 0)), confirmed: Boolean(field.confirmed),
  })) : [];
  const transcript = Array.isArray(value.transcript) ? (value.transcript as EscalationIntake["transcript"] & object).slice(-60).filter((turn) => turn && (turn.speaker === "caller" || turn.speaker === "ai") && typeof turn.text === "string").map((turn) => ({ speaker: turn.speaker, text: turn.text.slice(0, 2000) })) : [];
  return {
    channel, severity: severity as Severity, triggerCode, captured, transcript,
    dialedE164: typeof value.dialedE164 === "string" ? value.dialedE164 : null,
    widgetKey: typeof value.widgetKey === "string" ? value.widgetKey : null,
    signaling: (value.signaling || null) as EscalationIntake["signaling"],
    caller: { e164: normalizeE164(caller.e164), name: caller.name ? String(caller.name).slice(0, 160) : null, language: languages.has(String(caller.language)) ? String(caller.language) : "en" },
    triggerDetail: value.triggerDetail ? String(value.triggerDetail).slice(0, 300) : null,
    aiSummary: value.aiSummary ? String(value.aiSummary).slice(0, 1000) : null,
    serviceType: value.serviceType ? String(value.serviceType).slice(0, 80) : null,
    serviceLabel: value.serviceLabel ? String(value.serviceLabel).slice(0, 80) : null,
    urgency: (["emergency", "urgent", "standard", "info"] as const).find((item) => item === value.urgency) || (severity <= 1 ? "emergency" : severity === 2 ? "urgent" : "standard"),
  };
}

type ResolvedLine = { tenantId: Buffer; lineId: Buffer; mode: "owner" | "managed" | "shadow" };

async function resolveLine(unit: Unit, intake: EscalationIntake): Promise<ResolvedLine | null> {
  if (intake.channel === "chat") {
    if (!intake.widgetKey) return null;
    const [row] = await unit.tx.rows<{ tenant_id: Buffer; id: Buffer; desk_mode: ResolvedLine["mode"] }>(
      "SELECT ce.tenant_id, ce.id, t.desk_mode FROM channel_endpoints ce JOIN tenants t ON t.id = ce.tenant_id WHERE ce.widget_key = ? AND ce.kind = 'chat' AND ce.status = 'active' AND t.state NOT IN ('suspended','closed')",
      [intake.widgetKey],
    );
    return row ? { tenantId: row.tenant_id, lineId: row.id, mode: row.desk_mode } : null;
  }
  // The dialed number and every forwarding header must agree on one client.
  const numbers = [intake.dialedE164, intake.signaling?.to, ...(intake.signaling?.diversion || []), ...(intake.signaling?.historyInfo || [])].map(normalizeE164).filter((value): value is string => Boolean(value));
  if (!numbers.length) return null;
  const rows = await unit.tx.rows<{ e164: string; tenant_id: Buffer; id: Buffer; desk_mode: ResolvedLine["mode"] }>(
    `SELECT pn.e164, ce.tenant_id, ce.id, t.desk_mode FROM phone_numbers pn
       JOIN channel_endpoints ce ON ce.tenant_id = pn.tenant_id AND ce.phone_number_id = pn.id AND ce.kind = ? AND ce.status = 'active'
       JOIN tenants t ON t.id = pn.tenant_id
      WHERE pn.e164 IN (?) AND pn.status = 'active' AND t.state NOT IN ('suspended','closed')`,
    [intake.channel, numbers],
  );
  const dialed = normalizeE164(intake.dialedE164);
  const tenants = new Set(rows.map((row) => row.tenant_id.toString("hex")));
  if (tenants.size !== 1) return null;
  const exact = rows.find((row) => row.e164 === dialed) || (rows.length === 1 ? rows[0] : null);
  return exact ? { tenantId: exact.tenant_id, lineId: exact.id, mode: exact.desk_mode } : null;
}

async function upsertContact(unit: Unit, tenantId: Buffer, caller: EscalationIntake["caller"]) {
  if (!caller.e164) return null;
  const [existing] = await unit.tx.rows<{ id: Buffer }>("SELECT id FROM contacts WHERE tenant_id = ? AND phone_e164 = ? FOR UPDATE", [tenantId, caller.e164]);
  if (existing) {
    if (caller.name) await unit.tx.run("UPDATE contacts SET display_name = COALESCE(display_name, ?), updated_at = ? WHERE tenant_id = ? AND id = ?", [caller.name, unit.now, tenantId, existing.id]);
    return existing.id;
  }
  const contact = newId("ctc");
  await unit.tx.run(
    "INSERT INTO contacts (tenant_id, id, display_name, phone_e164, language, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
    [tenantId, contact.bytes, caller.name || null, caller.e164, caller.language || "en", unit.now, unit.now],
  );
  return contact.bytes;
}

export async function createEscalation(actor: DeskActor, input: unknown) {
  const intake = parseIntake(input);
  return runUnit(actor, async (unit) => {
    const line = await resolveLine(unit, intake);
    if (!line) {
      const incident = newId("uli");
      await unit.tx.run(
        "INSERT INTO unresolved_line_incidents (id, dialed_e164, caller_e164, channel, signaling, created_at) VALUES (?,?,?,?,?,?)",
        [incident.bytes, normalizeE164(intake.dialedE164), intake.caller.e164 || null, intake.channel, JSON.stringify(intake.signaling || { widget_key: intake.widgetKey || null }), unit.now],
      );
      await unit.outbox("support.unknown_line", null, incident.id, { incident_id: incident.id, channel: intake.channel });
      unit.audit({ tenantId: null, action: "intake.unknown_line", entityType: "unresolved_line", entityId: incident.id, before: null, after: { channel: intake.channel } });
      return { status: "unknown_line" as const, incidentId: incident.id };
    }
    const contactId = await upsertContact(unit, line.tenantId, intake.caller);
    const conversation = newId("cnv");
    await unit.tx.run(
      "INSERT INTO conversations (tenant_id, id, line_id, contact_id, channel, status, language, ai_summary, started_at) VALUES (?,?,?,?,?,'with_human',?,?,?)",
      [line.tenantId, conversation.bytes, line.lineId, contactId, intake.channel, intake.caller.language || "en", intake.aiSummary || null, unit.now],
    );
    let offset = -(intake.transcript?.length || 0);
    for (const turn of intake.transcript || []) {
      await unit.tx.run(
        "INSERT INTO messages (tenant_id, id, conversation_id, speaker, body, occurred_at) VALUES (?,?,?,?,?,?)",
        [line.tenantId, newId("msg").bytes, conversation.bytes, turn.speaker, turn.text, new Date(unit.now.getTime() + offset * 1000)],
      );
      offset += 1;
    }
    const request = newId("req");
    await unit.tx.run(
      `INSERT INTO requests (tenant_id, id, conversation_id, contact_id, source_channel, urgency, service_type, summary, captured_fields, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [line.tenantId, request.bytes, conversation.bytes, contactId, intake.channel, intake.urgency, intake.serviceType || null, intake.aiSummary || null, JSON.stringify(intake.captured || []), unit.now, unit.now],
    );
    const escalation = newId("esc");
    const snapshot = { summary: intake.aiSummary || null, captured: intake.captured || [], service_label: intake.serviceLabel || null };
    await unit.tx.run(
      `INSERT INTO escalations (tenant_id, id, conversation_id, line_id, channel, language, trigger_code, trigger_detail, severity, mode, state, sla_due_at, context_snapshot, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,'created',?,?,?,?)`,
      [line.tenantId, escalation.bytes, conversation.bytes, line.lineId, intake.channel, intake.caller.language || "en", intake.triggerCode, intake.triggerDetail || null,
        intake.severity, line.mode, slaDueAt(intake.severity, unit.now), JSON.stringify(snapshot), unit.now, unit.now],
    );
    await unit.escalationEvent(line.tenantId, escalation.bytes, "created", null, "created", { trigger: intake.triggerCode, severity: intake.severity });
    await unit.outbox("escalation.created", line.tenantId, escalation.id, { escalation_id: escalation.id, trigger: intake.triggerCode, severity: intake.severity, channel: intake.channel });
    await unit.outbox("request.created", line.tenantId, request.id, { request_id: request.id, conversation_id: conversation.id });
    unit.audit({ tenantId: line.tenantId, action: "escalation.created", entityType: "escalation", entityId: escalation.id, before: null, after: { trigger: intake.triggerCode, severity: intake.severity } });
    const row = await lockEscalation(unit.tx, line.tenantId, escalation.bytes);
    const routing = await dispatchEscalation(unit, row);
    return { status: "escalated" as const, escalationId: escalation.id, tenantId: ext("tnt", line.tenantId), conversationId: conversation.id, routing };
  });
}

// The AI recovered, or the caller hung up (§16.6 auto_resolved needs a reason).
export async function endFromCallerSide(actor: DeskActor, input: { tenantId: string; escalationId: string; reasonCode: string }) {
  const tenantId = toBinaryId("tnt", input.tenantId);
  const escalationId = toBinaryId("esc", input.escalationId);
  if (!/^[a-z0-9_]{2,48}$/.test(input.reasonCode || "")) throw new DeskError("invalid_input", "reasonCode must be a snake_case code.", 400);
  return runUnit(actor, async (unit) => {
    const escalation: EscalationRow = await lockEscalation(unit.tx, tenantId, escalationId);
    const [handling] = await unit.tx.rows<HandlingRow>("SELECT * FROM desk_handlings WHERE tenant_id = ? AND escalation_id = ? AND state NOT IN ('completed','failed') FOR UPDATE", [tenantId, escalationId]);
    if (handling && ["connecting", "active", "on_hold"].includes(handling.state)) {
      // The operator keeps the wrap-up; the caller simply left.
      const [profile] = await unit.tx.rows<{ wrap_up_seconds: number }>("SELECT wrap_up_seconds FROM client_desk_profiles WHERE tenant_id = ?", [tenantId]);
      await moveHandling(unit, handling, "wrap_up", "caller_ended", { ended_at: unit.now, wrap_started_at: unit.now, wrap_due_at: new Date(unit.now.getTime() + (profile?.wrap_up_seconds || 60) * 1000) }, { reason: input.reasonCode });
      await refreshPresence(unit, handling.operator_id);
      return { state: "wrap_up" as const };
    }
    if (!["created", "notified", "escalated"].includes(escalation.state)) return { state: escalation.state };
    await unit.tx.run("UPDATE call_offers SET outcome = 'cancelled', responded_at = ? WHERE tenant_id = ? AND escalation_id = ? AND outcome = 'pending'", [unit.now, tenantId, escalationId]);
    await moveEscalation(unit, escalation, "auto_resolved", "auto_resolved", { resolution_code: input.reasonCode, resolved_at: unit.now });
    await unit.tx.run("UPDATE conversations SET status = 'ended', ended_at = ? WHERE tenant_id = ? AND id = ?", [unit.now, tenantId, escalation.conversation_id]);
    return { state: "auto_resolved" as const };
  });
}

export async function appendCallerMessage(actor: DeskActor, input: { tenantId: string; escalationId: string; text: string }) {
  const tenantId = toBinaryId("tnt", input.tenantId);
  const escalationId = toBinaryId("esc", input.escalationId);
  const text = String(input.text || "").trim().slice(0, 2000);
  if (!text) throw new DeskError("invalid_input", "Message text is required.", 400);
  return runUnit(actor, async (unit) => {
    const escalation = await lockEscalation(unit.tx, tenantId, escalationId);
    const message = newId("msg");
    await unit.tx.run("INSERT INTO messages (tenant_id, id, conversation_id, speaker, body, occurred_at) VALUES (?,?,?,?,?,?)", [tenantId, message.bytes, escalation.conversation_id, "caller", text, unit.now]);
    await unit.outbox("message.received", tenantId, message.id, { conversation_id: ext("cnv", escalation.conversation_id) });
    return { messageId: message.id };
  });
}
