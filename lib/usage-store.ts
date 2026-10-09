import { createHash } from "node:crypto";
import type { UsageEvent } from "@/features/usage/types";
import { listRecords, removeRecord, updateRecord } from "./record-store";

const eventKey = (group: string, event: UsageEvent) => group + "/" + event.workspaceId + "_" + event.id;
const outboxKey = (event: UsageEvent) => eventKey("outbox", event) + "_" + createHash("sha256").update(JSON.stringify(event)).digest("hex").slice(0, 16);
export async function recordUsage(event: UsageEvent) {
  await updateRecord<UsageEvent>(eventKey("usage", event), (current) => {
    if (current && current.workspaceId !== event.workspaceId) throw new Error("Usage scope mismatch.");
    return current && current.status !== "pending" && event.status === "pending" ? current : event;
  });
}
export async function readUsageEvents(workspaceId: string) { return (await listRecords<UsageEvent>("usage")).filter((event) => event.workspaceId === workspaceId); }
export async function enqueueUsage(event: UsageEvent) { await updateRecord<UsageEvent>(outboxKey(event), () => event); }
export const readUsageOutbox = () => listRecords<UsageEvent>("outbox");
export const removeUsageOutbox = (event: UsageEvent) => removeRecord(outboxKey(event));
