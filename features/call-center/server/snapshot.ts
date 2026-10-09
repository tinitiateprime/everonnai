import "server-only";
import type { AuthActor } from "@/features/auth/types";
import { withDeskTransaction } from "@/lib/call-center-mysql";
import type { ActiveInteraction, Channel, DeskSnapshot, HandlingChannel, OfferCard, OperatorRole, PresenceStatus, QueueItem, RosterData, Severity, WallboardData } from "../types";
import { DeskError } from "../workflow";
import { loadClientDirectory, loadInteractionContext, type EscalationRow } from "./context";
import type { HandlingRow } from "./lifecycle";
import { assertLead, resolveOperator, type OperatorRow } from "./operators";
import { runSweep } from "./routing";
import { simulationScenarios } from "./simulation";
import { ext, iso, sameId } from "./unit";

const grantClause = "g.revoked_at IS NULL AND g.certified_at IS NOT NULL AND (g.expires_at IS NULL OR g.expires_at > ?)";

async function requireOperator(tx: Parameters<typeof resolveOperator>[0], actor: AuthActor) {
  const operator = await resolveOperator(tx, actor);
  if (!operator) throw new DeskError("forbidden", "Your account is not an active EverOnn operator.", 403);
  return operator;
}

export async function loadSnapshot(actor: AuthActor, sessionId: string): Promise<DeskSnapshot> {
  await runSweep().catch((error) => console.error("[call-center] sweep failed", (error as Error).message));
  return withDeskTransaction(async (tx) => {
    const now = new Date();
    const operator = await requireOperator(tx, actor);
    const [presence] = await tx.rows<{ status: PresenceStatus; status_since: Date; desk_session_id: string | null }>("SELECT status, status_since, desk_session_id FROM operator_presence WHERE operator_id = ? FOR UPDATE", [operator.id]);
    const superseded = Boolean(presence?.desk_session_id && presence.desk_session_id !== sessionId);
    // Each snapshot poll is the desk heartbeat (DSK-026); a superseded window
    // never refreshes the heartbeat of the session that replaced it.
    if (!superseded) {
      await tx.run(
        `INSERT INTO operator_presence (operator_id, status, status_since, last_heartbeat_at, desk_session_id) VALUES (?, 'offline', ?, ?, ?)
         ON DUPLICATE KEY UPDATE last_heartbeat_at = VALUES(last_heartbeat_at), desk_session_id = COALESCE(desk_session_id, VALUES(desk_session_id))`,
        [operator.id, now, now, sessionId],
      );
    }
    const [shift] = await tx.rows<{ id: Buffer }>("SELECT id FROM operator_shifts WHERE operator_id = ? AND ended_at IS NULL", [operator.id]);
    const operatorSummary = {
      operatorId: ext("opr", operator.id), displayName: operator.display_name, firstName: operator.first_name, role: operator.role, languages: operator.languages,
      maxVoice: operator.max_voice, maxChat: operator.max_chat, presence: presence?.status || "offline", presenceSince: (presence?.status_since || now).toISOString(), shiftOpen: Boolean(shift),
    };
    if (superseded) return { serverTime: now.toISOString(), superseded, operator: operatorSummary, offers: [], active: [], queue: [], stats: emptyStats() };
    const operatorView = { firstName: operator.first_name, announcementEnabled: Boolean(operator.announcement_enabled) };

    const offerRows = await tx.rows<{ id: Buffer; tenant_id: Buffer; escalation_id: Buffer; offered_at: Date; expires_at: Date }>(
      "SELECT id, tenant_id, escalation_id, offered_at, expires_at FROM call_offers WHERE operator_id = ? AND outcome = 'pending' AND expires_at > ? ORDER BY offered_at", [operator.id, now],
    );
    const offers: OfferCard[] = [];
    for (const offer of offerRows) {
      const [escalation] = await tx.rows<EscalationRow>("SELECT * FROM escalations WHERE tenant_id = ? AND id = ?", [offer.tenant_id, offer.escalation_id]);
      if (!escalation) continue;
      const context = await loadInteractionContext(tx, escalation, operatorView, now);
      offers.push({ ...context, offerId: ext("ofr", offer.id), offeredAt: offer.offered_at.toISOString(), expiresAt: offer.expires_at.toISOString() });
    }

    const handlings = await tx.rows<HandlingRow>("SELECT * FROM desk_handlings WHERE operator_id = ? AND state NOT IN ('completed','failed') ORDER BY accepted_at", [operator.id]);
    const active: ActiveInteraction[] = [];
    for (const handling of handlings) {
      const [escalation] = await tx.rows<EscalationRow>("SELECT * FROM escalations WHERE tenant_id = ? AND id = ?", [handling.tenant_id, handling.escalation_id]);
      if (!escalation) continue;
      const context = await loadInteractionContext(tx, escalation, operatorView, now, handling.channel === "callback" ? "callback" : undefined);
      // The greeting stays pinned to the script version recorded at acceptance.
      active.push({
        ...context,
        handlingId: ext("hdl", handling.id), channel: handling.channel, state: handling.state, muted: Boolean(handling.muted), acceptedAt: iso(handling.accepted_at),
        connectedAt: iso(handling.connected_at), holdStartedAt: iso(handling.hold_started_at), greetingDelivered: Boolean(handling.greeting_delivered),
        wrapDueAt: iso(handling.wrap_due_at), transferredTo: handling.transferred_to, version: handling.version,
      });
    }

    const queue = await loadQueue(tx, operator, now);
    const stats = await loadStats(tx, operator.id, now);
    return { serverTime: now.toISOString(), superseded, operator: operatorSummary, offers, active, queue, stats };
  });
}

function emptyStats() {
  return { handledToday: 0, avgHandleSeconds: null, greetingCompliance: null, wrongClient: 0, qaAverage: null };
}

// DSK-001: one queue across every client the operator is granted, sorted by
// severity then deadline. Ungranted clients never appear.
async function loadQueue(tx: Parameters<typeof resolveOperator>[0], operator: OperatorRow, now: Date): Promise<QueueItem[]> {
  const items: QueueItem[] = [];
  const waiting = await tx.rows<{ tenant_id: Buffer; id: Buffer; channel: Channel; severity: Severity; language: string; created_at: Date; sla_due_at: Date; state: string; cascade_step: number; trigger_code: string; client_name: string; brand_color: string; line_label: string; offered_to: Buffer | null; offered_name: string | null }>(
    `SELECT e.tenant_id, e.id, e.channel, e.severity, e.language, e.created_at, e.sla_due_at, e.state, e.cascade_step, e.trigger_code,
            t.display_name AS client_name, p.brand_color, ce.label AS line_label, co.operator_id AS offered_to, o.first_name AS offered_name
       FROM escalations e
       JOIN operator_client_grants g ON g.tenant_id = e.tenant_id AND g.operator_id = ? AND ${grantClause}
       JOIN tenants t ON t.id = e.tenant_id
       JOIN client_desk_profiles p ON p.tenant_id = e.tenant_id
       JOIN channel_endpoints ce ON ce.tenant_id = e.tenant_id AND ce.id = e.line_id
       LEFT JOIN call_offers co ON co.tenant_id = e.tenant_id AND co.escalation_id = e.id AND co.outcome = 'pending'
       LEFT JOIN operators o ON o.id = co.operator_id
      WHERE e.is_waiting = 1
      ORDER BY e.severity, e.sla_due_at LIMIT 100`,
    [operator.id, now],
  );
  for (const row of waiting) {
    const status = row.offered_to ? (sameId(row.offered_to, operator.id) ? "Ringing you" : `Ringing ${row.offered_name}`) : row.cascade_step >= 2 ? "Owner notified" : row.cascade_step === 1 ? "Overflow" : "Waiting";
    items.push({
      key: ext("esc", row.id), kind: "escalation", tenantId: ext("tnt", row.tenant_id), clientName: row.client_name, brandColor: row.brand_color, lineLabel: row.line_label,
      channel: row.channel, severity: row.severity, language: row.language, waitingSince: row.created_at.toISOString(), dueAt: row.sla_due_at.toISOString(), status, detail: row.trigger_code.replaceAll("_", " "),
    });
  }
  const callbacks = await tx.rows<{ tenant_id: Buffer; id: Buffer; severity: Severity; created_at: Date; due_at: Date; title: string; notes: string | null; client_name: string; brand_color: string; line_label: string | null; language: string | null }>(
    `SELECT tk.tenant_id, tk.id, tk.severity, tk.created_at, tk.due_at, tk.title, tk.notes, t.display_name AS client_name, p.brand_color, ce.label AS line_label, e.language
       FROM tasks tk
       JOIN operator_client_grants g ON g.tenant_id = tk.tenant_id AND g.operator_id = ? AND ${grantClause}
       JOIN tenants t ON t.id = tk.tenant_id
       JOIN client_desk_profiles p ON p.tenant_id = tk.tenant_id
       LEFT JOIN escalations e ON e.tenant_id = tk.tenant_id AND e.id = tk.escalation_id
       LEFT JOIN channel_endpoints ce ON ce.tenant_id = e.tenant_id AND ce.id = e.line_id
      WHERE tk.kind = 'callback' AND tk.state = 'open'
      ORDER BY tk.severity, tk.due_at LIMIT 50`,
    [operator.id, now],
  );
  for (const row of callbacks) {
    items.push({
      key: ext("tsk", row.id), kind: "callback", taskId: ext("tsk", row.id), tenantId: ext("tnt", row.tenant_id), clientName: row.client_name, brandColor: row.brand_color,
      lineLabel: row.line_label || "Callback", channel: "callback", severity: row.severity, language: row.language || "en", waitingSince: row.created_at.toISOString(), dueAt: row.due_at.toISOString(),
      status: row.due_at < now ? "Overdue callback" : "Callback promised", detail: row.notes || row.title,
    });
  }
  const approvals = await tx.rows<{ tenant_id: Buffer; id: Buffer; capability: string; request_detail: string; created_at: Date; client_name: string; brand_color: string }>(
    `SELECT a.tenant_id, a.id, a.capability, a.request_detail, a.created_at, t.display_name AS client_name, p.brand_color
       FROM approvals a JOIN tenants t ON t.id = a.tenant_id JOIN client_desk_profiles p ON p.tenant_id = a.tenant_id
      WHERE a.requested_by = ? AND a.state = 'pending' ORDER BY a.created_at LIMIT 20`,
    [operator.id],
  );
  for (const row of approvals) {
    items.push({
      key: ext("apr", row.id), kind: "approval", tenantId: ext("tnt", row.tenant_id), clientName: row.client_name, brandColor: row.brand_color, lineLabel: "Owner approval",
      channel: "voice", severity: 3, language: "en", waitingSince: row.created_at.toISOString(), dueAt: row.created_at.toISOString(), status: "Awaiting owner", detail: `${row.capability.replaceAll("_", " ")}: ${row.request_detail}`,
    });
  }
  // DSK-003: unknown lines carry no client data and only a neutral greeting.
  const unknown = await tx.rows<{ id: Buffer; channel: Channel; created_at: Date }>("SELECT id, channel, created_at FROM unresolved_line_incidents WHERE state = 'open' ORDER BY created_at LIMIT 20");
  for (const row of unknown) {
    items.push({
      key: ext("uli", row.id), kind: "unknown_line", incidentId: ext("uli", row.id), tenantId: null, clientName: "UNKNOWN LINE", brandColor: "#5b6573", lineLabel: "Unresolved line",
      channel: row.channel, severity: 2, language: "en", waitingSince: row.created_at.toISOString(), dueAt: row.created_at.toISOString(), status: "Support incident open", detail: "Use only: “Thank you for calling, how can I help?”",
    });
  }
  return items.sort((left, right) => left.severity - right.severity || left.dueAt.localeCompare(right.dueAt));
}

async function loadStats(tx: Parameters<typeof resolveOperator>[0], operatorId: Buffer, now: Date) {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [row] = await tx.rows<{ handled: number; avg_handle: string | null; greeting: string | null; wrong_client: string | null }>(
    `SELECT COUNT(*) AS handled,
            AVG(TIMESTAMPDIFF(SECOND, COALESCE(connected_at, accepted_at), COALESCE(wrap_ended_at, ended_at))) AS avg_handle,
            AVG(CASE WHEN channel IN ('voice','callback') THEN greeting_delivered END) AS greeting,
            SUM(wrong_client_flag) AS wrong_client
       FROM desk_handlings WHERE operator_id = ? AND state = 'completed' AND offered_at >= ?`,
    [operatorId, dayStart],
  );
  const [qa] = await tx.rows<{ average: string | null }>("SELECT AVG(q.overall) AS average FROM qa_reviews q JOIN desk_handlings h ON h.tenant_id = q.tenant_id AND h.id = q.handling_id WHERE h.operator_id = ?", [operatorId]);
  return {
    handledToday: Number(row?.handled || 0),
    avgHandleSeconds: row?.avg_handle === null || row?.avg_handle === undefined ? null : Math.round(Number(row.avg_handle)),
    greetingCompliance: row?.greeting === null || row?.greeting === undefined ? null : Number(row.greeting),
    wrongClient: Number(row?.wrong_client || 0),
    qaAverage: qa?.average === null || qa?.average === undefined ? null : Number(qa.average),
  };
}

export async function loadDirectory(actor: AuthActor) {
  return withDeskTransaction(async (tx) => {
    const operator = await requireOperator(tx, actor);
    return loadClientDirectory(tx, operator.id, new Date());
  });
}

export async function loadWallboard(actor: AuthActor): Promise<WallboardData & { scenarios: Array<{ key: string; label: string }> }> {
  return withDeskTransaction(async (tx) => {
    const now = new Date();
    const operator = await requireOperator(tx, actor);
    assertLead(operator);
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const clients = await tx.rows<{ id: Buffer; display_name: string; brand_color: string; waiting: string | null; urgent_waiting: string | null; oldest_created_at: Date | null; breached: string | null; active: number }>(
      `SELECT t.id, t.display_name, p.brand_color, q.waiting, q.urgent_waiting, q.oldest_created_at, q.breached,
              (SELECT COUNT(*) FROM desk_handlings h WHERE h.tenant_id = t.id AND h.state NOT IN ('completed','failed')) AS active
         FROM tenants t JOIN client_desk_profiles p ON p.tenant_id = t.id LEFT JOIN v_desk_queue_by_client q ON q.tenant_id = t.id
        WHERE t.state NOT IN ('closed') ORDER BY q.urgent_waiting DESC, q.waiting DESC, t.display_name`,
    );
    const operators = await tx.rows<{ id: Buffer; display_name: string; role: OperatorRole; languages: string[]; status: PresenceStatus | null; status_since: Date | null; last_heartbeat_at: Date | null; clients: string | null }>(
      `SELECT o.id, o.display_name, o.role, o.languages, p.status, p.status_since, p.last_heartbeat_at,
              (SELECT GROUP_CONCAT(DISTINCT t.display_name ORDER BY t.display_name SEPARATOR '|') FROM desk_handlings h JOIN tenants t ON t.id = h.tenant_id
                WHERE h.operator_id = o.id AND h.state NOT IN ('completed','failed')) AS clients
         FROM operators o LEFT JOIN operator_presence p ON p.operator_id = o.id WHERE o.status = 'active' ORDER BY FIELD(p.status, 'on_call','wrap_up','available','away','break','offline'), o.display_name`,
    );
    const [totals] = await tx.rows<{ escalations: number; urgent: string | null; urgent_in_sla: string | null; abandoned: string | null }>(
      `SELECT COUNT(*) AS escalations, SUM(severity <= 2) AS urgent,
              SUM(severity <= 2 AND acknowledged_at IS NOT NULL AND TIMESTAMPDIFF(MICROSECOND, created_at, acknowledged_at) <= 20000000) AS urgent_in_sla,
              SUM(state = 'auto_resolved' AND resolution_code = 'caller_left') AS abandoned
         FROM escalations WHERE created_at >= ?`,
      [dayStart],
    );
    const [handling] = await tx.rows<{ handled: number; wrong_client: string | null; active: string | null }>(
      "SELECT SUM(state = 'completed') AS handled, SUM(wrong_client_flag) AS wrong_client, SUM(state NOT IN ('completed','failed')) AS active FROM desk_handlings WHERE offered_at >= ? OR state NOT IN ('completed','failed')",
      [dayStart],
    );
    const approvals = await tx.rows<{ tenant_id: Buffer; id: Buffer; capability: string; request_detail: string; created_at: Date; client_name: string; requested_by: string }>(
      `SELECT a.tenant_id, a.id, a.capability, a.request_detail, a.created_at, t.display_name AS client_name, o.display_name AS requested_by
         FROM approvals a JOIN tenants t ON t.id = a.tenant_id JOIN operators o ON o.id = a.requested_by WHERE a.state = 'pending' ORDER BY a.created_at`,
    );
    const reviewable = await tx.rows<{ tenant_id: Buffer; id: Buffer; client_name: string; operator_name: string; channel: HandlingChannel; disposition: string | null; ended_at: Date | null; greeting_delivered: number; reviewed: number }>(
      `SELECT h.tenant_id, h.id, t.display_name AS client_name, o.display_name AS operator_name, h.channel, h.disposition, h.ended_at, h.greeting_delivered,
              EXISTS (SELECT 1 FROM qa_reviews q WHERE q.tenant_id = h.tenant_id AND q.handling_id = h.id) AS reviewed
         FROM desk_handlings h JOIN tenants t ON t.id = h.tenant_id JOIN operators o ON o.id = h.operator_id
        WHERE h.state = 'completed' ORDER BY h.wrap_ended_at DESC LIMIT 40`,
    );
    const escalationCount = Number(totals?.escalations || 0);
    const handled = Number(handling?.handled || 0);
    return {
      serverTime: now.toISOString(),
      clients: clients.map((row) => ({
        tenantId: ext("tnt", row.id), name: row.display_name, brandColor: row.brand_color, waiting: Number(row.waiting || 0), urgentWaiting: Number(row.urgent_waiting || 0),
        oldestWaitingSince: iso(row.oldest_created_at), breached: Number(row.breached || 0), activeHandlings: Number(row.active || 0),
      })),
      operators: operators.map((row) => ({
        operatorId: ext("opr", row.id), name: row.display_name, role: row.role, presence: row.status || "offline", since: (row.status_since || now).toISOString(),
        languages: row.languages, activeClients: row.clients ? row.clients.split("|") : [], lastHeartbeatAt: iso(row.last_heartbeat_at),
      })),
      totals: {
        waiting: clients.reduce((sum, row) => sum + Number(row.waiting || 0), 0), active: Number(handling?.active || 0), handledToday: handled,
        serviceLevel: Number(totals?.urgent || 0) ? Number(totals?.urgent_in_sla || 0) / Number(totals?.urgent) : null,
        abandonRate: escalationCount ? Number(totals?.abandoned || 0) / escalationCount : null,
        wrongClientRate: handled ? Number(handling?.wrong_client || 0) / handled : null,
      },
      approvals: approvals.map((row) => ({ id: ext("apr", row.id), tenantId: ext("tnt", row.tenant_id), clientName: row.client_name, capability: row.capability, detail: row.request_detail, requestedBy: row.requested_by, createdAt: row.created_at.toISOString() })),
      reviewable: reviewable.map((row) => ({
        handlingId: ext("hdl", row.id), tenantId: ext("tnt", row.tenant_id), clientName: row.client_name, operatorName: row.operator_name, channel: row.channel,
        disposition: row.disposition, endedAt: iso(row.ended_at), greetingDelivered: Boolean(row.greeting_delivered), reviewed: Boolean(Number(row.reviewed)),
      })),
      scenarios: simulationScenarios.map((scenario) => ({ key: scenario.key, label: scenario.label })),
    };
  });
}

export async function loadRoster(actor: AuthActor): Promise<RosterData> {
  return withDeskTransaction(async (tx) => {
    const now = new Date();
    const operator = await requireOperator(tx, actor);
    assertLead(operator);
    const operators = await tx.rows<{ id: Buffer; display_name: string; email: string; role: OperatorRole; languages: string[]; status: string }>("SELECT id, display_name, email, role, languages, status FROM operators ORDER BY display_name");
    const tenants = await tx.rows<{ id: Buffer; display_name: string; brand_color: string; vertical: string; desk_mode: string }>("SELECT t.id, t.display_name, p.brand_color, t.vertical, t.desk_mode FROM tenants t JOIN client_desk_profiles p ON p.tenant_id = t.id ORDER BY t.display_name");
    const lines = await tx.rows<{ tenant_id: Buffer; id: Buffer; label: string; kind: Channel; e164: string | null }>("SELECT ce.tenant_id, ce.id, ce.label, ce.kind, pn.e164 FROM channel_endpoints ce LEFT JOIN phone_numbers pn ON pn.tenant_id = ce.tenant_id AND pn.id = ce.phone_number_id WHERE ce.status = 'active' ORDER BY ce.label");
    const grants = await tx.rows<{ operator_id: Buffer; tenant_id: Buffer; skills: string[]; training_completed_at: Date | null; certified_at: Date | null; expires_at: Date | null; revoked_at: Date | null }>("SELECT operator_id, tenant_id, skills, training_completed_at, certified_at, expires_at, revoked_at FROM operator_client_grants");
    return {
      operators: operators.map((row) => ({ operatorId: ext("opr", row.id), name: row.display_name, email: row.email, role: row.role, languages: row.languages, status: row.status })),
      clients: tenants.map((row) => ({
        tenantId: ext("tnt", row.id), name: row.display_name, brandColor: row.brand_color, vertical: row.vertical, deskMode: row.desk_mode,
        lines: lines.filter((line) => sameId(line.tenant_id, row.id)).map((line) => ({ lineId: ext("lin", line.id), label: line.label, numberE164: line.e164, kind: line.kind })),
      })),
      grants: grants.map((row) => ({
        operatorId: ext("opr", row.operator_id), tenantId: ext("tnt", row.tenant_id), skills: row.skills, trainingCompletedAt: iso(row.training_completed_at), certifiedAt: iso(row.certified_at),
        expiresAt: iso(row.expires_at), revokedAt: iso(row.revoked_at), active: !row.revoked_at && Boolean(row.certified_at) && (!row.expires_at || row.expires_at > now),
      })),
    };
  });
}
