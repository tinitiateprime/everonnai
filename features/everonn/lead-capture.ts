import type { Contact, EverOnnWorkspace, Lead, Urgency } from "./types";

export type LeadCaptureInput = {
  callerName: string;
  callerPhone: string;
  callerEmail: string;
  reason: string;
  urgency: Urgency;
  source: Lead["source"];
  requestId?: string;
  finalize?: boolean;
  appointmentRequest?: Lead["appointmentRequest"];
};

const phoneKey = (value: string) => value.replace(/\D/g, "");
const genericName = (value: string) => /^(website visitor|ai caller|new customer)$/i.test(value);

export function captureWorkspaceLead(workspace: EverOnnWorkspace, input: LeadCaptureInput, now = new Date().toISOString()) {
  const existingContact = workspace.contacts.find((item) => Boolean(
    (input.callerPhone && phoneKey(item.phone) === phoneKey(input.callerPhone))
    || (input.callerEmail && item.email.toLowerCase() === input.callerEmail.toLowerCase())
  ));
  const existingLead = input.requestId
    ? workspace.leads.find((item) => item.requestId === input.requestId)
    : workspace.leads.find((item) => item.status === "new" && existingContact && item.contactId === existingContact.id);
  const previousContact = existingContact || workspace.contacts.find((item) => item.id === existingLead?.contactId);
  const contact: Contact = {
    ...previousContact,
    id: previousContact?.id || `contact_${crypto.randomUUID()}`,
    workspaceId: workspace.workspaceId,
    name: genericName(input.callerName) ? previousContact?.name || input.callerName : input.callerName,
    phone: input.callerPhone || previousContact?.phone || "",
    email: input.callerEmail || previousContact?.email || "",
    lastContactAt: now,
  };
  const lead: Lead = {
    ...existingLead,
    id: existingLead?.id || `lead_${crypto.randomUUID()}`,
    workspaceId: workspace.workspaceId,
    contactId: contact.id,
    callerName: genericName(input.callerName) ? existingLead?.callerName || contact.name : input.callerName,
    callerPhone: contact.phone,
    reason: input.reason || existingLead?.reason || "Customer callback request",
    urgency: input.urgency,
    source: input.source,
    status: existingLead?.status || "new",
    requestId: input.requestId || existingLead?.requestId,
    captureStatus: input.finalize === false ? existingLead?.captureStatus || "collecting" : "complete",
    appointmentRequest: input.appointmentRequest || existingLead?.appointmentRequest,
    createdAt: existingLead?.createdAt || now,
    updatedAt: now,
  };
  return {
    lead,
    contact,
    workspace: {
      ...workspace,
      contacts: previousContact ? workspace.contacts.map((item) => item.id === contact.id ? contact : item) : [contact, ...workspace.contacts],
      leads: existingLead ? workspace.leads.map((item) => item.id === lead.id ? lead : item) : [lead, ...workspace.leads],
    },
  };
}

// Provider results are server-owned. An old browser autosave must never reset a sent email or a booking.
export function preserveLeadServerState(current: Lead[], incoming: Lead[]) {
  const incomingIds = new Set(incoming.map((item) => item.id));
  return [...incoming.map((item) => {
    const saved = current.find((row) => row.id === item.id);
    if (!saved) return { ...item, automation: undefined };
    return { ...item, ...saved, status: item.status };
  }), ...current.filter((item) => !incomingIds.has(item.id))];
}

export function preserveContactServerState(current: Contact[], incoming: Contact[]) {
  const incomingIds = new Set(incoming.map((item) => item.id));
  return [...incoming.map((item) => {
    const saved = current.find((row) => row.id === item.id);
    return saved && Date.parse(saved.lastContactAt) > Date.parse(item.lastContactAt) ? saved : item;
  }), ...current.filter((item) => !incomingIds.has(item.id))];
}
