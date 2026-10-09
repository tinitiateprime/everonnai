import "server-only";
import type { DeskTx } from "@/lib/call-center-mysql";
import type { CapturedField, Channel, Severity } from "../types";
import { toBinaryId } from "../ids";
import { DeskError } from "../workflow";
import type { EscalationIntake } from "./intake";

// DEMONSTRATION ONLY. Telephony and the AI runtime are not yet connected to
// the desk, so operator leads can inject realistic escalations through the
// same intake path the runtime will call (POST /api/call-center/intake).

type Scenario = {
  key: string; label: string; trigger: string; detail: string; severity: Severity; serviceType: string; serviceLabel: string;
  summary: string; captured: CapturedField[]; transcript: Array<{ speaker: "caller" | "ai"; text: string }>;
};

export const simulationScenarios: Scenario[] = [
  {
    key: "lockout", label: "Car lockout, caller asks for a person", trigger: "caller_requested_human", detail: "Caller asked for a person after the AI captured details", severity: 2,
    serviceType: "lockout_car", serviceLabel: "Car lockout", summary: "Locked keys in a 2018 Honda Civic at 12 Oak St. Alone. Wants help now.",
    captured: [
      { field: "service_type", label: "Service", value: "Car lockout", confidence: 0.95, confirmed: true },
      { field: "address", label: "Address", value: "12 Oak St", confidence: 0.97, confirmed: true },
      { field: "vehicle", label: "Vehicle", value: "2018 Honda Civic", confidence: 0.88, confirmed: true },
      { field: "safety_status", label: "Safety status", value: null, confidence: 0, confirmed: false },
    ],
    transcript: [
      { speaker: "ai", text: "Thanks for calling. I'm the virtual assistant. What can I help with?" },
      { speaker: "caller", text: "I locked my keys in my car, it's a 2018 Civic, I'm at 12 Oak Street." },
      { speaker: "ai", text: "I'm sorry to hear that. I have 12 Oak Street and a 2018 Honda Civic. Are you somewhere safe?" },
      { speaker: "caller", text: "Can I just talk to someone?" },
    ],
  },
  {
    key: "gas", label: "Gas smell — safety emergency", trigger: "safety_emergency", detail: "Caller reports a gas smell near the water heater", severity: 1,
    serviceType: "gas_leak", serviceLabel: "Possible gas leak", summary: "Caller smells gas near the water heater in the basement. Has not left the house yet.",
    captured: [
      { field: "service_type", label: "Service", value: "Possible gas leak", confidence: 0.92, confirmed: true },
      { field: "address", label: "Address", value: "48 Pine Ridge Rd", confidence: 0.81, confirmed: false },
      { field: "safety_status", label: "Safety status", value: "Still inside", confidence: 0.9, confirmed: true },
    ],
    transcript: [
      { speaker: "caller", text: "There's a strong gas smell by my water heater." },
      { speaker: "ai", text: "Please leave the house now and call 911 or your gas utility from outside. I'm connecting you to a team member." },
    ],
  },
  {
    key: "quote", label: "Price request under a never-quote policy", trigger: "never_quote_policy", detail: "Caller insists on a price for a water heater replacement", severity: 3,
    serviceType: "water_heater_replacement", serviceLabel: "Water heater replacement", summary: "Wants a firm price for a 50-gallon gas water heater replacement this week.",
    captured: [
      { field: "service_type", label: "Service", value: "Water heater replacement", confidence: 0.94, confirmed: true },
      { field: "preferred_time", label: "Preferred time", value: "This week, mornings", confidence: 0.7, confirmed: false },
    ],
    transcript: [
      { speaker: "caller", text: "How much to replace a 50 gallon gas water heater?" },
      { speaker: "ai", text: "Pricing depends on the installation, so a team member will confirm. Can I take a few details?" },
      { speaker: "caller", text: "I just want a number. Let me talk to someone." },
    ],
  },
  {
    key: "spanish", label: "Spanish-speaking caller, no heat", trigger: "language_handoff", detail: "Caller prefers Spanish; furnace not working", severity: 2,
    serviceType: "no_heat", serviceLabel: "Sin calefacción", summary: "La calefacción no funciona desde anoche. Hay un bebé en la casa.",
    captured: [
      { field: "service_type", label: "Service", value: "No heat", confidence: 0.9, confirmed: true },
      { field: "address", label: "Address", value: "905 Maple Ave", confidence: 0.86, confirmed: true },
    ],
    transcript: [
      { speaker: "caller", text: "Hola, la calefacción no funciona y tengo un bebé en casa." },
      { speaker: "ai", text: "Entiendo. Le comunico con una persona del equipo." },
    ],
  },
];

export async function simulationIntake(tx: DeskTx, payload: Record<string, unknown>): Promise<EscalationIntake> {
  const scenario = simulationScenarios.find((item) => item.key === payload.scenario) || simulationScenarios[0];
  const channel: Channel = payload.channel === "chat" ? "chat" : payload.channel === "sms" ? "sms" : "voice";
  const tenantId = payload.tenant_id ? toBinaryId("tnt", payload.tenant_id) : null;
  if (payload.unknown_line === true) {
    return { channel: "voice", dialedE164: "+19995550000", caller: { e164: "+15555550199", name: null, language: "en" }, triggerCode: scenario.trigger, severity: scenario.severity, captured: [], transcript: [] };
  }
  const lines = await tx.rows<{ tenant_id: Buffer; kind: Channel; e164: string | null; widget_key: string | null }>(
    `SELECT ce.tenant_id, ce.kind, pn.e164, ce.widget_key FROM channel_endpoints ce LEFT JOIN phone_numbers pn ON pn.tenant_id = ce.tenant_id AND pn.id = ce.phone_number_id
      WHERE ce.status = 'active' AND ce.kind = ? ${tenantId ? "AND ce.tenant_id = ?" : ""} ORDER BY RAND() LIMIT 1`,
    tenantId ? [channel, tenantId] : [channel],
  );
  const line = lines[0];
  if (!line) throw new DeskError("not_found", `No active ${channel} line is configured for that client.`, 404);
  const callerNumber = `+1555${String(Math.floor(1000000 + Math.random() * 8999999))}`;
  const spanish = scenario.key === "spanish";
  return {
    channel, dialedE164: line.e164, widgetKey: line.widget_key, signaling: line.e164 ? { to: line.e164 } : null,
    caller: { e164: callerNumber, name: spanish ? "Lucía" : ["Maria", "James", "Priya", "Daniel"][Math.floor(Math.random() * 4)], language: spanish ? "es" : "en" },
    triggerCode: scenario.trigger, triggerDetail: scenario.detail, severity: scenario.severity, aiSummary: scenario.summary,
    serviceType: scenario.serviceType, serviceLabel: scenario.serviceLabel, captured: scenario.captured, transcript: scenario.transcript,
  };
}
