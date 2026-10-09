import "server-only";
import { createHash } from "node:crypto";
import { withDeskTransaction, type DeskTx } from "@/lib/call-center-mysql";
import { newId, toExternalId, type IdPrefix } from "../ids";

// A unit of work is one MySQL transaction plus the journal every desk change
// must leave behind: escalation/handling events (DSK-024), outbox domain
// events (Appendix C) and the hash-chained audit log (HIL-011, SEC-009).
export type DeskActor = { type: "system" | "operator" | "user" | "service"; id: string | null };
type AuditEntry = { tenantId: Buffer | null; action: string; entityType: string; entityId: string; before: unknown; after: unknown };

export type Unit = {
  tx: DeskTx;
  now: Date;
  actor: DeskActor;
  escalationEvent(tenantId: Buffer, escalationId: Buffer, type: string, from: string | null, to: string | null, detail?: Record<string, unknown>): Promise<void>;
  handlingEvent(tenantId: Buffer, handlingId: Buffer, type: string, detail?: Record<string, unknown>, operatorId?: Buffer | null): Promise<void>;
  outbox(type: string, tenantId: Buffer | null, aggregateId: string, data: Record<string, unknown>): Promise<void>;
  audit(entry: AuditEntry): void;
};

const escalationActorType = (actor: DeskActor) => actor.type === "service" ? "ai" : actor.type;

export async function runUnit<T>(actor: DeskActor, fn: (unit: Unit) => Promise<T>) {
  return withDeskTransaction(async (tx) => {
    // Truncate to milliseconds so values round-trip DATETIME(3) unchanged.
    const now = new Date(Math.floor(Date.now()));
    const auditQueue: AuditEntry[] = [];
    const unit: Unit = {
      tx, now, actor,
      async escalationEvent(tenantId, escalationId, type, from, to, detail = {}) {
        await tx.run(
          "INSERT INTO escalation_events (tenant_id, id, escalation_id, event_type, from_state, to_state, actor_type, actor_id, detail, occurred_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
          [tenantId, newId("eev").bytes, escalationId, type, from, to, escalationActorType(actor), actor.id, JSON.stringify(detail), now],
        );
      },
      async handlingEvent(tenantId, handlingId, type, detail = {}, operatorId = null) {
        await tx.run(
          "INSERT INTO handling_events (tenant_id, id, handling_id, event_type, operator_id, detail, occurred_at) VALUES (?,?,?,?,?,?,?)",
          [tenantId, newId("hev").bytes, handlingId, type, operatorId, JSON.stringify(detail), now],
        );
      },
      async outbox(type, tenantId, aggregateId, data) {
        await tx.run(
          "INSERT INTO outbox_events (id, tenant_id, event_type, aggregate_id, actor, data, occurred_at) VALUES (?,?,?,?,?,?,?)",
          [newId("evt").bytes, tenantId, type, aggregateId, JSON.stringify(actor), JSON.stringify({ ...data, tenant_id: toExternalId("tnt", tenantId) }), now],
        );
      },
      audit(entry) { auditQueue.push(entry); },
    };
    const result = await fn(unit);
    await flushAudit(tx, actor, now, auditQueue);
    return result;
  });
}

function canonical(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Buffer.isBuffer(value)) return JSON.stringify(value.toString("hex"));
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") return `{${Object.keys(value as object).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function auditHash(previous: Buffer, row: { tenantId: Buffer | null; actorType: string; actorId: string | null; action: string; entityType: string; entityId: string; before: unknown; after: unknown; occurredAt: Date }) {
  return createHash("sha256").update(previous).update(canonical(row)).digest();
}

// Appends are the last writes of the transaction, after every other row lock,
// so the single chain-head lock never participates in a lock-order cycle.
async function flushAudit(tx: DeskTx, actor: DeskActor, now: Date, entries: AuditEntry[]) {
  if (!entries.length) return;
  const [head] = await tx.rows<{ last_hash: Buffer }>("SELECT last_hash FROM audit_chain_head WHERE id = 1 FOR UPDATE");
  if (!head) throw new Error("The audit chain head is missing; apply the call center migration.");
  let previous = head.last_hash;
  let lastSeq = 0;
  for (const entry of entries) {
    const before = entry.before === undefined ? null : entry.before;
    const after = entry.after === undefined ? null : entry.after;
    const hash = auditHash(previous, { tenantId: entry.tenantId, actorType: actor.type, actorId: actor.id, action: entry.action, entityType: entry.entityType, entityId: entry.entityId, before, after, occurredAt: now });
    const result = await tx.run(
      "INSERT INTO audit_log (tenant_id, actor_type, actor_id, action, entity_type, entity_id, before_state, after_state, occurred_at, prev_hash, hash) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [entry.tenantId, actor.type, actor.id, entry.action, entry.entityType, entry.entityId, before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after), now, previous, hash],
    );
    previous = hash;
    lastSeq = result.insertId;
  }
  await tx.run("UPDATE audit_chain_head SET last_hash = ?, last_seq = ? WHERE id = 1", [previous, lastSeq]);
}

// Walks the chain and reports the first broken link (SEC-009 verification).
export async function verifyAuditChain(tx: DeskTx, limit = 100_000) {
  const rows = await tx.rows<{ seq: number; tenant_id: Buffer | null; actor_type: string; actor_id: string | null; action: string; entity_type: string; entity_id: string; before_state: unknown; after_state: unknown; occurred_at: Date; prev_hash: Buffer; hash: Buffer }>(
    "SELECT seq, tenant_id, actor_type, actor_id, action, entity_type, entity_id, before_state, after_state, occurred_at, prev_hash, hash FROM audit_log ORDER BY seq LIMIT ?", [limit],
  );
  let previous: Buffer = Buffer.alloc(32);
  for (const row of rows) {
    if (!row.prev_hash.equals(previous)) return { ok: false as const, brokenAt: row.seq, checked: rows.length };
    const expected = auditHash(previous, { tenantId: row.tenant_id, actorType: row.actor_type, actorId: row.actor_id, action: row.action, entityType: row.entity_type, entityId: row.entity_id, before: row.before_state, after: row.after_state, occurredAt: row.occurred_at });
    if (!expected.equals(row.hash)) return { ok: false as const, brokenAt: row.seq, checked: rows.length };
    previous = row.hash;
  }
  return { ok: true as const, checked: rows.length };
}

export const ext = (prefix: IdPrefix, value: Buffer | null | undefined) => toExternalId(prefix, value) as string;
export const iso = (value: Date | null | undefined) => value ? value.toISOString() : null;
export const sameId = (left: Buffer | null | undefined, right: Buffer | null | undefined) => Boolean(left && right && Buffer.compare(left, right) === 0);
