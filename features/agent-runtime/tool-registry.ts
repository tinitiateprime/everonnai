import type { BusinessProfile } from "@/features/everonn/types";
import { assertWorkspaceScope } from "@/features/auth/rbac";
import type { AgentCapability } from "./types";

// These descriptors identify existing, authorized workflows. They grant no execution access.
export const APPLICATION_TOOLS = [
  { id: "lead.capture", entryPoint: "/api/site-assistant/lead", permission: "authorized visitor or calls:operate", confirmation: "finalized customer request", result: "saved lead and verified booking state" },
  { id: "calendar.check_availability", entryPoint: "lead-automation", permission: "workspace Google Calendar connection", confirmation: "exact agreed service/date/time", result: "verified freeBusy availability" },
  { id: "calendar.create_appointment", entryPoint: "lead-automation", permission: "workspace Google Calendar connection", confirmation: "verified availability and finalized request", result: "provider event ID before confirmed state" },
  { id: "gmail.send_team_notification", entryPoint: "lead-automation", permission: "workspace Gmail send connection", confirmation: "configured team recipient and enabled follow-up", result: "provider message ID or uncertain delivery" },
  { id: "website.generate", entryPoint: "/api/website-studio", permission: "website:publish", confirmation: "owner generation request", result: "QA-checked private draft; publication requires separate approval" },
] as const;

export type WorkflowAvailability = {
  workspaceId: string;
  calendarConnected: boolean;
  calendarAvailability: boolean;
  gmailConnected: boolean;
  notificationsEnabled: boolean;
};

export function workflowAvailability(profile: BusinessProfile, scopes: readonly string[] = [], followUpEnabled = true): WorkflowAvailability {
  const calendarAvailability = scopes.some((scope) => ["calendar", "calendar.readonly", "calendar.freebusy", "calendar.events.freebusy"].some((key) => scope === `https://www.googleapis.com/auth/${key}`));
  const calendarWrite = scopes.some((scope) => ["calendar", "calendar.events"].some((key) => scope === `https://www.googleapis.com/auth/${key}`));
  return { workspaceId: profile.workspaceId,
    calendarConnected: calendarAvailability && calendarWrite, calendarAvailability,
    gmailConnected: scopes.includes("https://www.googleapis.com/auth/gmail.send"),
    notificationsEnabled: followUpEnabled && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email),
  };
}

export function availableWorkflows(workspaceId: string, capabilities: AgentCapability[], availability?: WorkflowAvailability) {
  if (availability) assertWorkspaceScope(workspaceId, availability.workspaceId);
  const assistant = capabilities.includes("assistant");
  const booking = capabilities.includes("appointment-booking");
  const website = capabilities.includes("website-building");
  return APPLICATION_TOOLS.filter((tool) => tool.id === "website.generate" ? website
    : tool.id === "lead.capture" ? assistant : assistant || booking).map((tool) => ({
      ...tool,
      execution: "application-managed; not an LLM-callable function or permission grant",
      available: tool.id === "calendar.check_availability" ? availability?.calendarAvailability === true
        : tool.id === "calendar.create_appointment" ? availability?.calendarConnected === true
        : tool.id.startsWith("gmail.") ? availability?.gmailConnected === true && availability.notificationsEnabled === true : true,
    }));
}
