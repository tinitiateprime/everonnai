import type { EverOnnWorkspace } from "./types";

function safeTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return value;
  } catch {
    return "UTC";
  }
}

export function createStarterWorkspace(input: {
  workspaceId: string;
  memberId: string;
  ownerName: string;
  ownerEmail: string;
  businessName: string;
  businessType: string;
  timeZone: string;
}): EverOnnWorkspace {
  const now = new Date().toISOString();
  const assistantName = "Ava";
  return {
    version: 1,
    workspaceId: input.workspaceId,
    profile: {
      id: `business_${crypto.randomUUID()}`,
      workspaceId: input.workspaceId,
      businessName: input.businessName,
      businessType: input.businessType,
      skillId: "general",
      description: "",
      phone: "",
      email: input.ownerEmail,
      website: "",
      location: "",
      serviceArea: "",
      hours: "",
      services: [],
      knowledge: [],
      greeting: `Thanks for contacting ${input.businessName}. I’m ${assistantName}, the virtual receptionist. How can I help today?`,
      assistantName,
      tone: "warm",
      emergencyRules: "For fire, gas smell, medical danger, or immediate safety risk, direct the customer to local emergency services and request an urgent human callback.",
      pricingRules: "Never invent or estimate prices. Capture the request and let the team provide a quote.",
      policies: "Never promise availability or an appointment until a connected calendar confirms the exact time.",
      transferNumber: "",
      timeZone: safeTimeZone(input.timeZone),
      appointmentDurationMinutes: 60,
      verified: false,
      updatedAt: now,
    },
    contacts: [],
    leads: [],
    conversations: [],
    appointments: [],
    websiteProject: null,
    integrations: { googleCalendar: "disconnected", gmail: "disconnected", elevenLabs: "not_configured" },
    team: [{ id: input.memberId, name: input.ownerName, email: input.ownerEmail, role: "owner", status: "active" }],
  };
}
