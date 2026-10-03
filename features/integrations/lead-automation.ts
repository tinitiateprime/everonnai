import "server-only";
import { extractAppointmentIntent } from "@/features/voice-agent/appointment";
import { readWorkspaceJson, updateWorkspaceJson } from "@/lib/json-workspace-store";
import { getGoogleConnection } from "@/lib/provider-credentials";
import { getValidGoogleAccessToken } from "./google-oauth";
import { bookGoogleCalendarAppointment, checkGoogleCalendarAvailability, findGoogleCalendarAppointment, sendGmailNotification } from "./google";
import { runLeadAutomation } from "./lead-automation-core";

const queues = new Map<string, Promise<unknown>>();

export function processLeadAutomation(leadId: string, workspaceId: string) {
  const previous = queues.get(workspaceId) || Promise.resolve();
  const operation = previous.catch(() => undefined).then(() => runLeadAutomation(leadId, workspaceId, {
    read: readWorkspaceJson,
    update: updateWorkspaceJson,
    getConnection: getGoogleConnection,
    getAccessToken: getValidGoogleAccessToken,
    extractIntent: (profile, reason, options) => extractAppointmentIntent(profile, reason, { ...options, usage: { workspaceId, feature: "appointment_extraction" } }),
    availability: checkGoogleCalendarAvailability,
    book: bookGoogleCalendarAppointment,
    findEvent: findGoogleCalendarAppointment,
    sendEmail: sendGmailNotification,
    followUpEnabled: String(process.env.PHONE_FRONT_DESK_FOLLOW_UP_ENABLED || "true").trim().toLowerCase() !== "false",
  }));
  queues.set(workspaceId, operation);
  void operation.finally(() => { if (queues.get(workspaceId) === operation) queues.delete(workspaceId); }).catch(() => undefined);
  return operation;
}
