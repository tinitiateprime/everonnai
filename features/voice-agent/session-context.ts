import type { CaptureResponse } from "./capture-client";

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
