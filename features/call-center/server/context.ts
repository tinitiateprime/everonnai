import "server-only";
import type { DeskTx } from "@/lib/call-center-mysql";
import type {
  AuthorityMatrix, CapturedField, Channel, ClientDirectoryEntry, CoverageWindow, EscalationState, HoursMode, InteractionContext, Severity,
} from "../types";
import { announcementText, hoursModeFor, maskPhone, maskSensitiveText, renderGreeting, visibleCapturedFields, withinWindows } from "../workflow";
import { ext, iso } from "./unit";

export type TenantRow = { id: Buffer; display_name: string; brand_name: string; time_zone: string; desk_mode: "owner" | "managed" | "shadow"; state: string };
export type ProfileRow = {
  spoken_name: string; pronunciation: string | null; brand_color: string; authority_matrix: AuthorityMatrix; operator_notes: string | null;
  special_handling: { vip_list?: string[]; blocked_addresses?: string[]; instructions?: string[] };
  business_facts: { hours?: string; business_hours?: CoverageWindow[]; services?: string[]; service_area?: string; pricing_policy?: string; payment_methods?: string[] };
  do_not_say: string[]; coverage: CoverageWindow[]; visible_fields: string[]; required_wrap_fields: string[];
  playbook_slots: Array<{ field: string; label: string; required: boolean }>; canned_replies: string[]; announcement_enabled: number; wrap_up_seconds: number;
};
export type EscalationRow = {
  tenant_id: Buffer; id: Buffer; conversation_id: Buffer; line_id: Buffer; channel: Channel; language: string; trigger_code: string; trigger_detail: string | null;
  severity: Severity; mode: "owner" | "managed" | "shadow"; state: EscalationState; cascade_step: number; sla_due_at: Date; context_snapshot: { summary?: string; captured?: CapturedField[]; service_label?: string };
  created_at: Date; version: number;
};

export async function loadTenant(tx: DeskTx, tenantId: Buffer) {
  const [tenant] = await tx.rows<TenantRow>("SELECT id, display_name, brand_name, time_zone, desk_mode, state FROM tenants WHERE id = ?", [tenantId]);
  const [profile] = await tx.rows<ProfileRow>("SELECT * FROM client_desk_profiles WHERE tenant_id = ?", [tenantId]);
  return tenant && profile ? { tenant, profile } : null;
}

export function clientStatus(profile: ProfileRow, timeZone: string, now: Date) {
  return withinWindows(profile.business_facts.business_hours || [], timeZone, now) ? "open" as const : "after_hours" as const;
}

export function operatorCoverage(profile: ProfileRow, timeZone: string, now: Date) {
  return withinWindows(profile.coverage, timeZone, now);
}

// Picks the newest approved script for the language and hours mode, falling
// back to English, then to the neutral greeting that includes the client name.
export async function resolveGreeting(tx: DeskTx, tenantId: Buffer, language: string, hoursMode: HoursMode) {
  const rows = await tx.rows<{ id: Buffer; script_version: number; body: string; language: string }>(
    `SELECT id, script_version, body, language FROM greeting_scripts
      WHERE tenant_id = ? AND status = 'approved' AND hours_mode = ? AND language IN (?, 'en')
      ORDER BY language = ? DESC, script_version DESC LIMIT 1`,
    [tenantId, hoursMode, language, language],
  );
  return rows[0] || null;
}

export async function loadInteractionContext(tx: DeskTx, escalation: EscalationRow, operator: { firstName: string; announcementEnabled: boolean }, now: Date, hoursModeOverride?: HoursMode): Promise<InteractionContext> {
  const loaded = await loadTenant(tx, escalation.tenant_id);
  if (!loaded) throw new Error("Client desk profile is missing.");
  const { tenant, profile } = loaded;
  const tenantId = escalation.tenant_id;
  const [line] = await tx.rows<{ id: Buffer; label: string; kind: Channel; e164: string | null }>(
    "SELECT ce.id, ce.label, ce.kind, pn.e164 FROM channel_endpoints ce LEFT JOIN phone_numbers pn ON pn.tenant_id = ce.tenant_id AND pn.id = ce.phone_number_id WHERE ce.tenant_id = ? AND ce.id = ?",
    [tenantId, escalation.line_id],
  );
  const [conversation] = await tx.rows<{ contact_id: Buffer | null; ai_summary: string | null }>(
    "SELECT contact_id, ai_summary FROM conversations WHERE tenant_id = ? AND id = ?", [tenantId, escalation.conversation_id],
  );
  const contactRows = conversation?.contact_id ? await tx.rows<{ id: Buffer; display_name: string | null; phone_e164: string | null; is_vip: number; language: string }>(
    "SELECT id, display_name, phone_e164, is_vip, language FROM contacts WHERE tenant_id = ? AND id = ?", [tenantId, conversation.contact_id],
  ) : [];
  const contact = contactRows[0];
  const history = contact ? await tx.rows<{ id: Buffer; channel: Channel; started_at: Date; ai_summary: string | null }>(
    "SELECT id, channel, started_at, ai_summary FROM conversations WHERE tenant_id = ? AND contact_id = ? AND id <> ? ORDER BY started_at DESC LIMIT 5",
    [tenantId, contact.id, escalation.conversation_id],
  ) : [];
  const [request] = await tx.rows<{ id: Buffer; version: number; status: string; urgency: string; service_type: string | null; summary: string | null; captured_fields: CapturedField[] }>(
    "SELECT id, version, status, urgency, service_type, summary, captured_fields FROM requests WHERE tenant_id = ? AND conversation_id = ?", [tenantId, escalation.conversation_id],
  );
  const transcript = await tx.rows<{ id: Buffer; speaker: "caller" | "ai" | "operator" | "system"; body: string; occurred_at: Date }>(
    "SELECT id, speaker, body, occurred_at FROM (SELECT id, speaker, body, occurred_at FROM messages WHERE tenant_id = ? AND conversation_id = ? ORDER BY occurred_at DESC LIMIT 80) recent ORDER BY occurred_at",
    [tenantId, escalation.conversation_id],
  );
  const transfers = await tx.rows<{ id: Buffer; name: string; role_label: string; phone_e164: string; on_call: number }>(
    "SELECT id, name, role_label, phone_e164, on_call FROM client_transfer_contacts WHERE tenant_id = ? ORDER BY priority, name", [tenantId],
  );
  const approvals = await tx.rows<{ id: Buffer; capability: string; state: string; request_detail: string; decision_note: string | null }>(
    "SELECT id, capability, state, request_detail, decision_note FROM approvals WHERE tenant_id = ? AND escalation_id = ? ORDER BY created_at", [tenantId, escalation.id],
  );
  const hoursMode = hoursModeOverride || hoursModeFor(profile.business_facts.business_hours || [], tenant.time_zone, now);
  const script = await resolveGreeting(tx, tenantId, escalation.language, hoursMode);
  const lineLabel = line?.label || "Main line";
  const captured = visibleCapturedFields(escalation.context_snapshot.captured || [], profile.visible_fields);
  const callerName = contact?.display_name || null;
  return {
    client: {
      tenantId: ext("tnt", tenantId), name: tenant.display_name, spokenName: profile.spoken_name, pronunciation: profile.pronunciation,
      brandColor: profile.brand_color, brandName: tenant.brand_name, status: clientStatus(profile, tenant.time_zone, now), timeZone: tenant.time_zone,
    },
    line: { lineId: ext("lin", escalation.line_id), label: lineLabel, numberE164: line?.e164 || null, kind: line?.kind || escalation.channel, resolution: "exact" },
    escalation: {
      id: ext("esc", escalation.id), severity: escalation.severity, trigger: escalation.trigger_code, triggerDetail: escalation.trigger_detail, state: escalation.state,
      language: escalation.language, channel: escalation.channel, createdAt: escalation.created_at.toISOString(), slaDueAt: escalation.sla_due_at.toISOString(), cascadeStep: escalation.cascade_step,
    },
    greeting: {
      scriptId: script ? ext("grt", script.id) : null, version: script?.script_version ?? null, hoursMode,
      text: renderGreeting(script?.body || null, { clientName: profile.spoken_name || tenant.display_name, operatorFirstName: operator.firstName, lineLabel }),
    },
    announcement: {
      enabled: escalation.channel === "voice" && Boolean(profile.announcement_enabled) && operator.announcementEnabled,
      text: announcementText({ clientName: tenant.display_name, serviceLabel: escalation.context_snapshot.service_label || null, callerName, severity: escalation.severity }),
    },
    caller: {
      contactId: contact ? ext("ctc", contact.id) : null, name: callerName, numberE164: contact?.phone_e164 || null, returning: history.length > 0,
      priorInteractions: history.length, vip: Boolean(contact?.is_vip), language: contact?.language || escalation.language,
    },
    ai: { summary: conversation?.ai_summary ? maskSensitiveText(conversation.ai_summary) : escalation.context_snapshot.summary || null, captured },
    request: request ? {
      id: ext("req", request.id), version: request.version, status: request.status, urgency: request.urgency, serviceType: request.service_type,
      summary: request.summary, fields: visibleCapturedFields(request.captured_fields, profile.visible_fields),
    } : null,
    transcript: transcript.map((row) => ({ id: ext("msg", row.id), speaker: row.speaker, text: maskSensitiveText(row.body), at: row.occurred_at.toISOString() })),
    authority: profile.authority_matrix,
    instructions: {
      ownerNotes: profile.operator_notes, vipList: profile.special_handling.vip_list || [], blockedAddresses: profile.special_handling.blocked_addresses || [],
      special: profile.special_handling.instructions || [], doNotSay: profile.do_not_say,
    },
    business: {
      hours: profile.business_facts.hours || null, services: profile.business_facts.services || [], serviceArea: profile.business_facts.service_area || null,
      pricingPolicy: profile.business_facts.pricing_policy || null, paymentMethods: profile.business_facts.payment_methods || [],
    },
    transferContacts: transfers.map((row) => ({ id: ext("xfr", row.id), name: row.name, role: row.role_label, maskedNumber: maskPhone(row.phone_e164), onCall: Boolean(row.on_call) })),
    callerHistory: history.map((row) => ({ conversationId: ext("cnv", row.id), channel: row.channel, startedAt: row.started_at.toISOString(), summary: row.ai_summary })),
    playbookSlots: profile.playbook_slots,
    cannedReplies: profile.canned_replies,
    requiredWrapFields: profile.required_wrap_fields,
    approvals: approvals.map((row) => ({ id: ext("apr", row.id), capability: row.capability, state: row.state, detail: row.request_detail, decisionNote: row.decision_note })),
  };
}

export async function loadClientDirectory(tx: DeskTx, operatorId: Buffer, now: Date): Promise<ClientDirectoryEntry[]> {
  const tenants = await tx.rows<TenantRow & ProfileRow>(
    `SELECT t.id, t.display_name, t.brand_name, t.time_zone, t.desk_mode, t.state, p.*
       FROM operator_client_grants g JOIN tenants t ON t.id = g.tenant_id JOIN client_desk_profiles p ON p.tenant_id = t.id
      WHERE g.operator_id = ? AND g.revoked_at IS NULL AND g.certified_at IS NOT NULL AND (g.expires_at IS NULL OR g.expires_at > ?)
      ORDER BY t.display_name`,
    [operatorId, now],
  );
  const entries: ClientDirectoryEntry[] = [];
  for (const tenant of tenants) {
    const greetings = await tx.rows<{ language: string; hours_mode: HoursMode; script_version: number; body: string }>(
      `SELECT g.language, g.hours_mode, g.script_version, g.body FROM greeting_scripts g
        WHERE g.tenant_id = ? AND g.status = 'approved'
          AND g.script_version = (SELECT MAX(x.script_version) FROM greeting_scripts x WHERE x.tenant_id = g.tenant_id AND x.language = g.language AND x.hours_mode = g.hours_mode AND x.status = 'approved')
        ORDER BY g.language, g.hours_mode`,
      [tenant.id],
    );
    const lines = await tx.rows<{ label: string; kind: Channel; e164: string | null }>(
      "SELECT ce.label, ce.kind, pn.e164 FROM channel_endpoints ce LEFT JOIN phone_numbers pn ON pn.tenant_id = ce.tenant_id AND pn.id = ce.phone_number_id WHERE ce.tenant_id = ? AND ce.status = 'active' ORDER BY ce.label",
      [tenant.id],
    );
    entries.push({
      tenantId: ext("tnt", tenant.id), name: tenant.display_name, spokenName: tenant.spoken_name, pronunciation: tenant.pronunciation, brandColor: tenant.brand_color,
      status: clientStatus(tenant, tenant.time_zone, now), timeZone: tenant.time_zone, operatorNotes: tenant.operator_notes, authority: tenant.authority_matrix,
      greetings: greetings.map((row) => ({ language: row.language, hoursMode: row.hours_mode, version: row.script_version, text: row.body })),
      business: {
        hours: tenant.business_facts.hours || null, services: tenant.business_facts.services || [], serviceArea: tenant.business_facts.service_area || null,
        pricingPolicy: tenant.business_facts.pricing_policy || null, paymentMethods: tenant.business_facts.payment_methods || [],
      },
      lines: lines.map((row) => ({ label: row.label, kind: row.kind, numberE164: row.e164 })),
    });
  }
  return entries;
}

export { iso };
