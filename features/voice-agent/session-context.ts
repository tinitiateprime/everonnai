import type { BusinessProfile } from "@/features/everonn/types";
import type { CaptureResponse } from "./capture-client";
import { buildReceptionistPrompt } from "./engine";

export function buildVoiceSessionVariables(profile: BusinessProfile, calendarConnected: boolean) {
  const instructions = buildReceptionistPrompt(profile);
  return {
    business_name: profile.businessName,
    business_type: profile.businessType,
    assistant_name: profile.assistantName,
    services: profile.services.filter((item) => item.active).map((item) => `${item.name}: ${item.description}`).join("; "),
    business_hours: profile.hours || "Hours have not been provided. Ask the team; do not invent hours.",
    service_area: profile.serviceArea,
    greeting: profile.greeting,
    approved_instructions: instructions,
    // The currently configured ElevenLabs template consumes faq_notes.
    faq_notes: instructions,
    pricing_rules: profile.pricingRules,
    policies: profile.policies,
    transfer_number_configured: profile.transferNumber ? "yes" : "no",
    calendar_connected: calendarConnected ? "true" : "false",
    time_zone: profile.timeZone,
    appointment_duration_minutes: String(profile.appointmentDurationMinutes),
    language: "English",
  };
}

export function bookingToolResult(data: CaptureResponse | null, message = "The request could not be saved.") {
  return JSON.stringify({
    saved: Boolean(data?.saved),
    booked: data?.appointment?.status === "confirmed",
    appointment_status: data?.lead.automation?.appointmentStatus || "not_requested",
    service: data?.appointment?.service || "",
    date: data?.appointment?.date || "",
    time: data?.appointment?.time || "",
    time_zone: data?.appointment?.timeZone || "",
    message: data?.automationError || data?.lead.automation?.message || message,
  });
}
