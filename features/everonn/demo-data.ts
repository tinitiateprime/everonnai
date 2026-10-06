import type { EverOnnWorkspace } from "./types";

const now = "2026-09-29T08:30:00.000Z";

export function createDemoWorkspace(): EverOnnWorkspace {
  return {
    version: 1,
    workspaceId: "workspace_everonn_demo",
    profile: {
      id: "business_northstar",
      workspaceId: "workspace_everonn_demo",
      businessName: "Northstar Heating & Cooling",
      businessType: "HVAC service company",
      skillId: "hvac",
      description: "A locally operated heating and cooling company helping residential customers with repairs, seasonal maintenance, and replacement estimates.",
      phone: "+1 (555) 014-2187",
      email: "hello@northstar.example",
      website: "",
      location: "Denver, Colorado",
      serviceArea: "Denver and nearby communities",
      hours: "Monday–Friday, 8:00 AM–6:00 PM; emergency requests captured after hours",
      services: [
        { id: "svc_repair", name: "Heating and cooling repair", description: "Diagnosis and repair requests for residential systems.", active: true },
        { id: "svc_maintenance", name: "Seasonal maintenance", description: "Tune-up and preventative maintenance requests.", active: true },
        { id: "svc_estimate", name: "Replacement estimates", description: "Requests for system replacement consultations.", active: true },
      ],
      knowledge: [
        { id: "kb_1", category: "faq", question: "Do you offer after-hours support?", answer: "EverOnn captures urgent after-hours requests and alerts the team. Exact arrival times are confirmed by a person.", approved: true, updatedAt: now },
        { id: "kb_2", category: "policy", question: "Can the assistant quote a price?", answer: "No. Collect the equipment and issue details, then tell the customer the team will confirm pricing.", approved: true, updatedAt: now },
        { id: "kb_3", category: "handoff", question: "When should a person take over?", answer: "Request a human callback for safety concerns, complaints, unusual equipment, or whenever the customer asks for a person.", approved: true, updatedAt: now },
      ],
      greeting: "Thanks for calling Northstar Heating & Cooling. I’m Ava, the virtual receptionist. How can I help today?",
      assistantName: "Ava",
      tone: "warm",
      emergencyRules: "For fire, gas smell, medical danger, or immediate safety risk, tell the caller to contact local emergency services and request an urgent human callback.",
      pricingRules: "Never invent or estimate prices. Capture the request and let the team provide a quote.",
      policies: "Never promise arrival times or availability unless a connected calendar confirms the exact slot.",
      transferNumber: "+1 (555) 014-2188",
      timeZone: "America/Denver",
      appointmentDurationMinutes: 60,
      verified: true,
      updatedAt: now,
    },
    contacts: [
      { id: "contact_1", workspaceId: "workspace_everonn_demo", name: "Maria Lopez", phone: "+1 (555) 010-4412", email: "maria@example.com", lastContactAt: "2026-09-29T08:24:00.000Z" },
      { id: "contact_2", workspaceId: "workspace_everonn_demo", name: "Daniel Brooks", phone: "+1 (555) 010-7804", email: "", lastContactAt: "2026-09-28T18:10:00.000Z" },
      { id: "contact_3", workspaceId: "workspace_everonn_demo", name: "Taylor Reed", phone: "+1 (555) 010-0931", email: "taylor@example.com", lastContactAt: "2026-09-28T15:35:00.000Z" },
    ],
    leads: [
      { id: "lead_1", workspaceId: "workspace_everonn_demo", contactId: "contact_1", callerName: "Maria Lopez", callerPhone: "+1 (555) 010-4412", reason: "Furnace is making a loud rattling sound", source: "phone", urgency: "high", status: "new", createdAt: "2026-09-29T08:24:00.000Z" },
      { id: "lead_2", workspaceId: "workspace_everonn_demo", contactId: "contact_2", callerName: "Daniel Brooks", callerPhone: "+1 (555) 010-7804", reason: "Seasonal maintenance request", source: "chat", urgency: "normal", status: "qualified", createdAt: "2026-09-28T18:10:00.000Z" },
      { id: "lead_3", workspaceId: "workspace_everonn_demo", contactId: "contact_3", callerName: "Taylor Reed", callerPhone: "+1 (555) 010-0931", reason: "Replacement estimate", source: "website", urgency: "low", status: "follow_up", createdAt: "2026-09-28T15:35:00.000Z" },
    ],
    conversations: [
      { id: "conv_1", workspaceId: "workspace_everonn_demo", channel: "phone", status: "handoff", contactName: "Maria Lopez", contactPhone: "+1 (555) 010-4412", summary: "Caller reported a loud furnace noise and requested an urgent callback.", urgency: "high", createdAt: "2026-09-29T08:24:00.000Z", messages: [] },
      { id: "conv_2", workspaceId: "workspace_everonn_demo", channel: "chat", status: "completed", contactName: "Daniel Brooks", contactPhone: "+1 (555) 010-7804", summary: "Captured a seasonal maintenance request for next week.", urgency: "normal", createdAt: "2026-09-28T18:10:00.000Z", messages: [] },
    ],
    appointments: [
      { id: "appt_1", workspaceId: "workspace_everonn_demo", contactName: "Daniel Brooks", contactPhone: "+1 (555) 010-7804", service: "Seasonal maintenance", date: "2026-10-02", time: "10:30", status: "requested", provider: "manual", createdAt: "2026-09-28T18:12:00.000Z" },
    ],
    websiteProject: null,
    integrations: { googleCalendar: "disconnected", gmail: "disconnected", elevenLabs: "not_configured" },
    team: [
      { id: "member_owner", name: "Alex Morgan", email: "owner@northstar.example", role: "owner", status: "active" },
      { id: "member_manager", name: "Jordan Lee", email: "ops@northstar.example", role: "manager", status: "active" },
      { id: "member_invite", name: "Sam Rivera", email: "sam@northstar.example", role: "agent", status: "invited" },
    ],
  };
}
