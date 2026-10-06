import "server-only";
import type { BusinessProfile } from "@/features/everonn/types";
import { buildReceptionistPrompt } from "@/features/agent-runtime/prompt-composer";
import type { WorkflowAvailability } from "@/features/agent-runtime/tool-registry";

export function buildVoiceSessionVariables(profile: BusinessProfile, calendarConnected: boolean, actions?: WorkflowAvailability) {
  const state = actions || { workspaceId: profile.workspaceId, calendarConnected, calendarAvailability: calendarConnected, gmailConnected: false, notificationsEnabled: false };
  const instructions = `${buildReceptionistPrompt(profile, state)}\nCALENDAR CONNECTED: ${state.calendarConnected}. The existing capture tool returns verified booking state; calendar connection alone does not confirm a booking.`;
  return {
    business_name: profile.businessName, business_type: profile.businessType, assistant_name: profile.assistantName,
    services: profile.services.filter((item) => item.active).map((item) => `${item.name}: ${item.description}`).join("; "),
    business_hours: profile.hours || "Hours have not been provided. Ask the team; do not invent hours.",
    service_area: profile.serviceArea, greeting: profile.greeting, approved_instructions: instructions,
    // The configured ElevenLabs template consumes faq_notes; both placeholders receive the same composed skills.
    faq_notes: instructions, pricing_rules: profile.pricingRules, policies: profile.policies,
    transfer_number_configured: profile.transferNumber ? "yes" : "no", calendar_connected: state.calendarConnected ? "true" : "false",
    time_zone: profile.timeZone, appointment_duration_minutes: String(profile.appointmentDurationMinutes), language: "English",
  };
}
