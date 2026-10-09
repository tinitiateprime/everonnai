import "server-only";
import { withDeskConnection } from "@/lib/call-center-mysql";
import { newId } from "../ids";
import { cascadeDecision, heartbeatTimeoutSeconds, offerTtlSeconds, selectOperator, type RoutingCandidate } from "../workflow";
import { loadTenant, operatorCoverage, type EscalationRow } from "./context";
import { captureMessage, completeHandling, lockEscalation, lockHandling, moveEscalation, moveHandling, refreshPresence, requeueEscalation, type HandlingRow } from "./lifecycle";
import { ext, runUnit, type Unit } from "./unit";

// EscalationRouter (HIL-006, DSK-018) and the durable-timer sweep (§16.6:
// timers live in MySQL rows, never in an in-memory scheduler).

const offerTtl = () => Math.max(5, Number(process.env.CALL_CENTER_OFFER_TTL_SECONDS || offerTtlSeconds)) * 1000;

type CandidateRow = { id: Buffer; languages: string[]; max_voice: number; max_chat: number; idle_since: Date | null; open_voice: number; open_chat: number; has_pending: number; excluded: number; missed: number };

async function routingCandidates(unit: Unit, escalation: EscalationRow): Promise<Array<RoutingCandidate & { bytes: Buffer }>> {
  const heartbeatFloor = new Date(unit.now.getTime() - heartbeatTimeoutSeconds * 1000);
  const rows = await unit.tx.rows<CandidateRow>(
    `SELECT o.id, o.languages, o.max_voice, o.max_chat, p.idle_since,
            (SELECT COUNT(*) FROM desk_handlings h WHERE h.operator_id = o.id AND h.channel IN ('voice','callback') AND h.state NOT IN ('completed','failed')) AS open_voice,
            (SELECT COUNT(*) FROM desk_handlings h WHERE h.operator_id = o.id AND h.channel IN ('chat','sms') AND h.state NOT IN ('completed','failed')) AS open_chat,
            EXISTS (SELECT 1 FROM call_offers co WHERE co.operator_id = o.id AND co.outcome = 'pending') AS has_pending,
            EXISTS (SELECT 1 FROM call_offers co WHERE co.tenant_id = ? AND co.escalation_id = ? AND co.operator_id = o.id AND co.outcome IN ('declined','accepted')) AS excluded,
            EXISTS (SELECT 1 FROM call_offers co WHERE co.tenant_id = ? AND co.escalation_id = ? AND co.operator_id = o.id AND co.outcome = 'timed_out') AS missed
       FROM operators o
       JOIN operator_presence p ON p.operator_id = o.id
       JOIN operator_client_grants g ON g.operator_id = o.id AND g.tenant_id = ?
      WHERE o.status = 'active' AND p.status = 'available' AND p.last_heartbeat_at > ?
        AND g.revoked_at IS NULL AND g.certified_at IS NOT NULL AND (g.expires_at IS NULL OR g.expires_at > ?)`,
    [escalation.tenant_id, escalation.id, escalation.tenant_id, escalation.id, escalation.tenant_id, heartbeatFloor, unit.now],
  );
  return rows.map((row) => ({
    bytes: row.id, operatorId: ext("opr", row.id), languages: row.languages, idleSince: row.idle_since, openVoice: Number(row.open_voice), openChat: Number(row.open_chat),
    maxVoice: row.max_voice, maxChat: row.max_chat, excluded: Boolean(Number(row.excluded)), missed: Boolean(Number(row.missed)), hasPendingOffer: Boolean(Number(row.has_pending)),
  }));
}

async function createOffer(unit: Unit, escalation: EscalationRow, operator: Buffer) {
  // Lock the operator's presence so two routers cannot ring the same person.
  await unit.tx.rows("SELECT operator_id FROM operator_presence WHERE operator_id = ? FOR UPDATE", [operator]);
  const [busy] = await unit.tx.rows<{ pending: number }>("SELECT COUNT(*) AS pending FROM call_offers WHERE operator_id = ? AND outcome = 'pending'", [operator]);
  if (Number(busy?.pending || 0) > 0) return false;
  const offer = newId("ofr");
  const expiresAt = new Date(unit.now.getTime() + offerTtl());
  await unit.tx.run(
    "INSERT INTO call_offers (tenant_id, id, escalation_id, operator_id, cascade_step, offered_at, expires_at, outcome) VALUES (?,?,?,?,?,?,?,'pending')",
    [escalation.tenant_id, offer.bytes, escalation.id, operator, escalation.cascade_step, unit.now, expiresAt],
  );
  const detail = { offer_id: offer.id, operator_id: ext("opr", operator), expires_at: expiresAt.toISOString(), cascade_step: escalation.cascade_step };
  await moveEscalation(unit, escalation, "notified", "notified", { assigned_type: "operator", assigned_id: operator }, detail);
  await unit.outbox("offer.created", escalation.tenant_id, offer.id, detail);
  return true;
}

// Advances one escalation through the cascade until it is offered, waiting,
// or captured as a message.
export async function dispatchEscalation(unit: Unit, escalation: EscalationRow) {
  const loaded = await loadTenant(unit.tx, escalation.tenant_id);
  if (!loaded) return "missing_profile";
  const managed = escalation.mode !== "owner" && loaded.tenant.desk_mode !== "owner";
  const withinCoverage = operatorCoverage(loaded.profile, loaded.tenant.time_zone, unit.now);
  for (let guard = 0; guard < 4; guard += 1) {
    const candidates = managed && withinCoverage ? await routingCandidates(unit, escalation) : [];
    const requireLanguage = escalation.cascade_step === 0;
    const pick = selectOperator(candidates, escalation.channel, escalation.language, requireLanguage);
    const decision = cascadeDecision({ step: escalation.cascade_step, slaDueAt: escalation.sla_due_at, now: unit.now, severity: escalation.severity, hasCandidate: Boolean(pick), withinCoverage, managed });
    if (decision.action === "offer" && pick) {
      const offered = await createOffer(unit, escalation, candidates.find((candidate) => candidate.operatorId === pick.operatorId)!.bytes);
      return offered ? "offered" : "waiting";
    }
    if (decision.action === "advance") {
      await moveEscalation(unit, escalation, "escalated", "escalated", { cascade_step: decision.toStep, sla_due_at: decision.nextDueAt }, { cascade_step: decision.toStep, reason: managed && withinCoverage ? "no_operator_accepted" : "outside_operator_coverage" });
      if (decision.toStep === 2) await unit.outbox("escalation.owner_notified", escalation.tenant_id, ext("esc", escalation.id), { escalation_id: ext("esc", escalation.id), severity: escalation.severity });
      continue;
    }
    if (decision.action === "capture_message") {
      await captureMessage(unit, escalation);
      return "message_captured";
    }
    return "waiting";
  }
  return "waiting";
}

const sweepState = { running: false, last: 0 };

export async function runSweep(force = false) {
  const nowMs = Date.now();
  if (sweepState.running || (!force && nowMs - sweepState.last < 750)) return { skipped: true };
  sweepState.running = true;
  sweepState.last = nowMs;
  try {
    // A MySQL named lock keeps concurrent app instances from sweeping at once.
    return await withDeskConnection(async (lockConnection) => {
      const [lock] = await lockConnection.rows<{ acquired: number | null }>("SELECT GET_LOCK('everonn_desk_sweep', 0) AS acquired");
      if (Number(lock?.acquired) !== 1) return { skipped: true };
      try {
        const expired = await expireOffers();
        const disconnected = await expireHeartbeats();
        const revoked = await enforceRevocations();
        const released = await releaseWrapUps();
        const dispatched = await dispatchWaiting();
        return { skipped: false, expired, disconnected, revoked, released, dispatched };
      } finally {
        await lockConnection.rows("SELECT RELEASE_LOCK('everonn_desk_sweep')");
      }
    });
  } finally {
    sweepState.running = false;
  }
}

const system = { type: "system" as const, id: "desk-sweep" };

async function expireOffers() {
  return runUnit(system, async (unit) => {
    const offers = await unit.tx.rows<{ tenant_id: Buffer; id: Buffer; escalation_id: Buffer; operator_id: Buffer }>(
      "SELECT tenant_id, id, escalation_id, operator_id FROM call_offers WHERE outcome = 'pending' AND expires_at <= ? ORDER BY expires_at LIMIT 50 FOR UPDATE SKIP LOCKED",
      [unit.now],
    );
    for (const offer of offers) {
      await unit.tx.run("UPDATE call_offers SET outcome = 'timed_out', responded_at = ? WHERE tenant_id = ? AND id = ? AND outcome = 'pending'", [unit.now, offer.tenant_id, offer.id]);
      await unit.escalationEvent(offer.tenant_id, offer.escalation_id, "offer.timed_out", null, null, { offer_id: ext("ofr", offer.id), operator_id: ext("opr", offer.operator_id) });
      await unit.outbox("offer.timed_out", offer.tenant_id, ext("ofr", offer.id), { offer_id: ext("ofr", offer.id), operator_id: ext("opr", offer.operator_id) });
      // Automatic away after repeated missed offers (DSK-014).
      await unit.tx.run(
        `UPDATE operator_presence p JOIN operators o ON o.id = p.operator_id
            SET p.missed_offers = p.missed_offers + 1,
                p.status = IF(p.missed_offers >= o.missed_offer_limit AND p.status = 'available', 'away', p.status),
                p.status_since = IF(p.missed_offers >= o.missed_offer_limit AND p.status = 'away', ?, p.status_since),
                p.version = p.version + 1
          WHERE p.operator_id = ?`,
        [unit.now, offer.operator_id],
      );
    }
    return offers.length;
  });
}

async function closeOutHandling(unit: Unit, handling: HandlingRow, reason: string) {
  if (handling.state === "wrap_up" || handling.state === "ended") {
    await completeHandling(unit, handling, "auto_released");
    return;
  }
  await moveHandling(unit, handling, "failed", "handling.failed", { ended_at: unit.now }, { reason });
  await unit.outbox("handling.failed", handling.tenant_id, ext("hdl", handling.id), { handling_id: ext("hdl", handling.id), reason });
  await requeueEscalation(unit, handling.escalation_id, handling.tenant_id, reason);
  await refreshPresence(unit, handling.operator_id);
}

// DSK-026: missed heartbeats mark the operator offline; live interactions
// return to the queue and pending offers are withdrawn.
async function expireHeartbeats() {
  return runUnit(system, async (unit) => {
    const floor = new Date(unit.now.getTime() - heartbeatTimeoutSeconds * 1000);
    const stale = await unit.tx.rows<{ operator_id: Buffer; status: string }>(
      "SELECT operator_id, status FROM operator_presence WHERE status <> 'offline' AND (last_heartbeat_at IS NULL OR last_heartbeat_at < ?) LIMIT 25 FOR UPDATE SKIP LOCKED",
      [floor],
    );
    for (const presence of stale) {
      await unit.tx.run("UPDATE call_offers SET outcome = 'cancelled', responded_at = ? WHERE operator_id = ? AND outcome = 'pending'", [unit.now, presence.operator_id]);
      const handlings = await unit.tx.rows<HandlingRow>("SELECT * FROM desk_handlings WHERE operator_id = ? AND state NOT IN ('completed','failed') FOR UPDATE", [presence.operator_id]);
      for (const handling of handlings) await closeOutHandling(unit, handling, "operator_disconnected");
      await unit.tx.run("UPDATE operator_presence SET status = 'offline', status_since = ?, desk_session_id = NULL, version = version + 1 WHERE operator_id = ?", [unit.now, presence.operator_id]);
      await unit.outbox("operator.presence_changed", null, ext("opr", presence.operator_id), { operator_id: ext("opr", presence.operator_id), from: presence.status, to: "offline", reason: "heartbeat_lost" });
      unit.audit({ tenantId: null, action: "operator.disconnected", entityType: "operator", entityId: ext("opr", presence.operator_id), before: { status: presence.status }, after: { status: "offline" } });
    }
    return stale.length;
  });
}

// DSK-002: revocation moves the operator out of open interactions promptly.
async function enforceRevocations() {
  return runUnit(system, async (unit) => {
    const rows = await unit.tx.rows<{ tenant_id: Buffer; id: Buffer }>(
      `SELECT h.tenant_id, h.id FROM desk_handlings h
         LEFT JOIN operator_client_grants g ON g.operator_id = h.operator_id AND g.tenant_id = h.tenant_id
        WHERE h.state NOT IN ('completed','failed')
          AND (g.operator_id IS NULL OR g.revoked_at IS NOT NULL OR g.certified_at IS NULL OR (g.expires_at IS NOT NULL AND g.expires_at <= ?))
        LIMIT 25`,
      [unit.now],
    );
    for (const row of rows) {
      const handling = await lockHandling(unit.tx, row.tenant_id, row.id);
      if (handling.state === "completed" || handling.state === "failed") continue;
      if (handling.state === "wrap_up" || handling.state === "ended") await completeHandling(unit, handling, "auto_released");
      else await closeOutHandling(unit, handling, "grant_revoked");
    }
    await unit.tx.run(
      `UPDATE call_offers co JOIN operator_client_grants g ON g.operator_id = co.operator_id AND g.tenant_id = co.tenant_id
          SET co.outcome = 'cancelled', co.responded_at = ?
        WHERE co.outcome = 'pending' AND (g.revoked_at IS NOT NULL OR (g.expires_at IS NOT NULL AND g.expires_at <= ?))`,
      [unit.now, unit.now],
    );
    return rows.length;
  });
}

// DSK-019: wrap-up has a timer with automatic release.
async function releaseWrapUps() {
  return runUnit(system, async (unit) => {
    const rows = await unit.tx.rows<HandlingRow>(
      "SELECT * FROM desk_handlings WHERE state = 'wrap_up' AND wrap_due_at <= ? ORDER BY wrap_due_at LIMIT 25 FOR UPDATE SKIP LOCKED", [unit.now],
    );
    for (const handling of rows) await completeHandling(unit, handling, "auto_released");
    return rows.length;
  });
}

async function dispatchWaiting() {
  return runUnit(system, async (unit) => {
    const waiting = await unit.tx.rows<EscalationRow>(
      `SELECT e.* FROM escalations e
        WHERE e.is_waiting = 1 AND e.cascade_step < 3
          AND NOT EXISTS (SELECT 1 FROM call_offers co WHERE co.tenant_id = e.tenant_id AND co.escalation_id = e.id AND co.outcome = 'pending')
        ORDER BY e.severity, e.sla_due_at LIMIT 25 FOR UPDATE SKIP LOCKED`,
    );
    let offered = 0;
    for (const escalation of waiting) {
      const fresh = await lockEscalation(unit.tx, escalation.tenant_id, escalation.id);
      if ((await dispatchEscalation(unit, fresh)) === "offered") offered += 1;
    }
    return offered;
  });
}
