import type { Appointment, EverOnnWorkspace } from "./types";
import { createDemoWorkspace } from "./demo-data";

// Recognize the exact legacy seed without deleting or relabeling customer bookings.
export function isSampleAppointment(appointment: Appointment) {
  return appointment.id === "appt_1" && appointment.workspaceId === "workspace_everonn_demo"
    && appointment.provider === "manual" && !appointment.leadId
    && appointment.contactName === "Daniel Brooks" && appointment.contactPhone === "+1 (555) 010-7804"
    && appointment.service === "Seasonal maintenance" && appointment.createdAt === "2026-09-28T18:12:00.000Z";
}

export function customerWorkspaceView(workspace: EverOnnWorkspace) {
  if (workspace.workspaceId !== "workspace_everonn_demo") return workspace;
  const seed = createDemoWorkspace();
  const isExactSeed = (item: object, samples: object[]) => samples.some((sample) => Object.keys(sample).every((key) => JSON.stringify(item[key as keyof typeof item]) === JSON.stringify(sample[key as keyof typeof sample])));
  const leads = workspace.leads.filter((item) => !isExactSeed(item, seed.leads));
  return {
    ...workspace,
    contacts: workspace.contacts.filter((item) => leads.some((lead) => lead.contactId === item.id) || !isExactSeed(item, seed.contacts)),
    leads,
    conversations: workspace.conversations.filter((item) => !isExactSeed(item, seed.conversations)),
    appointments: workspace.appointments.filter((item) => !isSampleAppointment(item)),
  };
}
