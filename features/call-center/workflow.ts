// Pure Live Agent Desk rules: state machines (§16.6), service levels and
// cascade (HIL-002, DSK-018), authority (DSK-008), greetings (DSK-006),
// coverage windows (DSK-022) and wrap-up validation (DSK-019). No I/O here so
// the rules are unit-tested and shared by the service and the desk UI.
import type {
  AuthorityCapability, AuthorityLevel, AuthorityMatrix, CapturedField, Channel, CoverageWindow, DeskErrorCode,
  Disposition, EscalationState, HandlingState, HoursMode, OfferOutcome, Severity,
} from "./types";

export class DeskError extends Error {
  constructor(readonly code: DeskErrorCode, message: string, readonly status = 409) {
    super(message);
  }
}

const escalationTransitions: Record<EscalationState, readonly EscalationState[]> = {
  created: ["notified", "escalated", "auto_resolved"],
  notified: ["notified", "acknowledged", "escalated", "auto_resolved"],
  escalated: ["notified", "escalated", "acknowledged", "auto_resolved"],
  acknowledged: ["in_progress", "escalated", "resolved", "auto_resolved"],
  in_progress: ["resolved", "escalated"],
  resolved: ["reviewed"],
  auto_resolved: ["reviewed"],
  reviewed: ["closed"],
  closed: [],
};

const handlingTransitions: Record<HandlingState, readonly HandlingState[]> = {
  accepted: ["connecting", "active", "failed"],
  connecting: ["active", "failed", "ended", "wrap_up", "completed"],
  active: ["on_hold", "ended", "wrap_up", "failed", "completed"],
  on_hold: ["active", "ended", "wrap_up", "failed", "completed"],
  ended: ["wrap_up", "completed"],
  wrap_up: ["completed"],
  completed: [],
  failed: [],
};

const offerTransitions: Record<OfferOutcome, readonly OfferOutcome[]> = {
  pending: ["accepted", "declined", "timed_out", "cancelled"],
  accepted: [], declined: [], timed_out: [], cancelled: [],
};

export function canTransitionEscalation(from: EscalationState, to: EscalationState) {
  return escalationTransitions[from].includes(to);
}
export function canTransitionHandling(from: HandlingState, to: HandlingState) {
  return handlingTransitions[from].includes(to);
}
export function canTransitionOffer(from: OfferOutcome, to: OfferOutcome) {
  return offerTransitions[from].includes(to);
}
export function assertHandlingTransition(from: HandlingState, to: HandlingState) {
  if (!canTransitionHandling(from, to)) throw new DeskError("invalid_state", `The interaction cannot move from ${from} to ${to}.`);
}
export function assertEscalationTransition(from: EscalationState, to: EscalationState) {
  if (!canTransitionEscalation(from, to)) throw new DeskError("invalid_state", `The escalation cannot move from ${from} to ${to}.`);
}

export const openHandlingStates: readonly HandlingState[] = ["accepted", "connecting", "active", "on_hold", "ended", "wrap_up"];
export const liveHandlingStates: readonly HandlingState[] = ["accepted", "connecting", "active", "on_hold"];

// HIL-002 first-response SLAs (configurable defaults). P1 is "immediate"; it
// still gets a short deadline so the cascade advances without waiting.
export const severitySlaSeconds: Record<Severity, number> = { 1: 20, 2: 60, 3: 15 * 60, 4: 24 * 60 * 60 };
export const callbackDueSeconds: Record<Severity, number> = { 1: 5 * 60, 2: 15 * 60, 3: 60 * 60, 4: 24 * 60 * 60 };
export const offerTtlSeconds = 15;
export const heartbeatTimeoutSeconds = 30;
export const defaultWrapUpSeconds = 60;

export function slaDueAt(severity: Severity, from: Date) {
  return new Date(from.getTime() + severitySlaSeconds[severity] * 1000);
}

// Cascade steps (DSK-018): 0 skills-first pool, 1 overflow (any granted
// operator), 2 client owner notified while operators keep ringing, 3 message
// capture with a promised callback task.
export const cascadeSteps = ["skills_pool", "overflow_pool", "owner", "message_capture"] as const;
export type CascadeDecision =
  | { action: "offer"; step: number; requireLanguage: boolean }
  | { action: "advance"; toStep: number; nextDueAt: Date }
  | { action: "capture_message" }
  | { action: "wait" };

export function cascadeDecision(input: { step: number; slaDueAt: Date; now: Date; severity: Severity; hasCandidate: boolean; withinCoverage: boolean; managed: boolean }): CascadeDecision {
  const { step, now, severity } = input;
  const overdue = input.slaDueAt.getTime() <= now.getTime();
  const operatorsAllowed = input.managed && input.withinCoverage;
  if (!operatorsAllowed) {
    if (step < 2) return { action: "advance", toStep: 2, nextDueAt: new Date(now.getTime() + severitySlaSeconds[severity] * 1000) };
    return overdue ? { action: "capture_message" } : { action: "wait" };
  }
  if (step === 0) return input.hasCandidate ? { action: "offer", step, requireLanguage: true } : { action: "advance", toStep: 1, nextDueAt: input.slaDueAt };
  if (step === 1) {
    if (overdue) return { action: "advance", toStep: 2, nextDueAt: new Date(now.getTime() + severitySlaSeconds[severity] * 1000) };
    return input.hasCandidate ? { action: "offer", step, requireLanguage: false } : { action: "wait" };
  }
  if (step === 2) {
    if (overdue) return { action: "capture_message" };
    return input.hasCandidate ? { action: "offer", step, requireLanguage: false } : { action: "wait" };
  }
  return { action: "wait" };
}

// Routing candidate selection (HIL-006, DSK-018): skills-first then
// longest-idle. Inputs are already filtered by grant, presence and heartbeat.
// `excluded` (declined, or previously accepted) is permanent for the
// escalation; `missed` (timed out) only yields to anyone else eligible —
// repeated misses set the operator to away instead (DSK-014).
export type RoutingCandidate = { operatorId: string; languages: string[]; idleSince: Date | null; openVoice: number; openChat: number; maxVoice: number; maxChat: number; excluded: boolean; missed?: boolean; hasPendingOffer: boolean };
export function selectOperator(candidates: RoutingCandidate[], channel: Channel, language: string, requireLanguage: boolean): RoutingCandidate | null {
  const fresh = pickOperator(candidates.filter((candidate) => !candidate.missed), channel, language, requireLanguage);
  return fresh || pickOperator(candidates, channel, language, requireLanguage);
}
function pickOperator(candidates: RoutingCandidate[], channel: Channel, language: string, requireLanguage: boolean) {
  const eligible = candidates.filter((candidate) => {
    if (candidate.excluded || candidate.hasPendingOffer) return false;
    if (requireLanguage && !candidate.languages.includes(language)) return false;
    if (channel === "voice") return candidate.openVoice < candidate.maxVoice;
    return candidate.openChat < candidate.maxChat && candidate.openVoice === 0;
  });
  eligible.sort((left, right) => {
    const languageRank = Number(right.languages.includes(language)) - Number(left.languages.includes(language));
    if (languageRank) return languageRank;
    return (left.idleSince?.getTime() ?? 0) - (right.idleSince?.getTime() ?? 0);
  });
  return eligible[0] || null;
}

// Authority matrix (DSK-008). Unknown capabilities default to the most
// conservative level.
export function authorityFor(matrix: AuthorityMatrix, capability: AuthorityCapability): AuthorityLevel {
  return matrix[capability] || "not_allowed";
}

// Coverage windows are interpreted in the client's own time zone.
function localParts(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value || "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(value("weekday"));
  return { day, minutes: Number(value("hour")) * 60 + Number(value("minute")) };
}
const toMinutes = (value: string) => {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + (minute || 0);
};
export function withinWindows(windows: CoverageWindow[], timeZone: string, now: Date) {
  if (!windows.length) return false;
  const { day, minutes } = localParts(now, timeZone);
  return windows.some((window) => {
    const start = toMinutes(window.start);
    const end = toMinutes(window.end);
    if (end > start) return window.days.includes(day) && minutes >= start && minutes < end;
    // Overnight window, e.g. 18:00-08:00: the start day owns the evening part.
    return (window.days.includes(day) && minutes >= start) || (window.days.includes((day + 6) % 7) && minutes < end);
  });
}

export function hoursModeFor(businessHours: CoverageWindow[], timeZone: string, now: Date, channel: "inbound" | "callback" | "outbound" = "inbound"): HoursMode {
  if (channel === "callback") return "callback";
  if (channel === "outbound") return "outbound";
  return withinWindows(businessHours, timeZone, now) ? "business_hours" : "after_hours";
}

export const neutralGreeting = "Thank you for calling, how can I help?";

export function renderGreeting(template: string | null, variables: { clientName: string; operatorFirstName: string; lineLabel: string }) {
  if (!template) return `Thank you for calling ${variables.clientName}, this is ${variables.operatorFirstName}. How can I help?`;
  return template
    .replaceAll("{client_name}", variables.clientName)
    .replaceAll("{operator_first_name}", variables.operatorFirstName)
    .replaceAll("{line_label}", variables.lineLabel);
}

export function announcementText(input: { clientName: string; serviceLabel: string | null; callerName: string | null; severity: Severity }) {
  const urgency = input.severity <= 1 ? "Emergency." : input.severity === 2 ? "Urgent." : "";
  return [`${input.clientName}.`, input.serviceLabel ? `${input.serviceLabel}.` : "", input.callerName ? `Caller ${input.callerName}.` : "", urgency].filter(Boolean).join(" ");
}

// Data minimization (DSK-010): operators see only fields the client made
// visible, and transfer numbers are masked (click-to-bridge by id).
export function visibleCapturedFields(fields: CapturedField[], visible: string[]) {
  if (!visible.length || visible.includes("*")) return fields;
  return fields.filter((field) => visible.includes(field.field));
}
export function maskPhone(e164: string) {
  return e164.length <= 4 ? "••••" : `${"•".repeat(Math.max(0, e164.length - 4))}${e164.slice(-4)}`;
}
const sensitivePatterns = [/\b(?:\d[ -]?){13,19}\b/g, /\b\d{3}-\d{2}-\d{4}\b/g];
export function maskSensitiveText(text: string) {
  return sensitivePatterns.reduce((value, pattern) => value.replace(pattern, (match) => `[masked •••${match.replace(/\D/g, "").slice(-4)}]`), text);
}

export type WrapUpInput = { disposition: Disposition; operatorNotes: string; clientNotes: string; followUp?: { dueAt: string; notes: string } | null };
const dispositionValues: readonly Disposition[] = ["resolved", "message_taken", "transferred_to_owner", "callback_scheduled", "handed_back_to_ai", "spam", "wrong_number", "other"];
export function validateWrapUp(input: Partial<WrapUpInput>, requiredFields: string[]) {
  const errors: string[] = [];
  if (!input.disposition || !dispositionValues.includes(input.disposition)) errors.push("Choose a disposition.");
  if (requiredFields.includes("client_notes") && !input.clientNotes?.trim()) errors.push("This client requires notes for the owner.");
  if (requiredFields.includes("operator_notes") && !input.operatorNotes?.trim()) errors.push("This client requires internal notes.");
  if (input.disposition === "callback_scheduled" && !input.followUp?.dueAt) errors.push("Set when the callback is due.");
  if (input.followUp?.dueAt && Number.isNaN(Date.parse(input.followUp.dueAt))) errors.push("The follow-up time is not a valid date.");
  if ((input.operatorNotes?.length || 0) > 2000 || (input.clientNotes?.length || 0) > 2000) errors.push("Notes are limited to 2,000 characters.");
  return errors;
}

export function normalizeE164(value: unknown) {
  if (typeof value !== "string") return null;
  const digits = value.replace(/[^\d+]/g, "");
  const normalized = digits.startsWith("+") ? digits : digits.length === 10 ? `+1${digits}` : `+${digits}`;
  return /^\+[1-9]\d{6,14}$/.test(normalized) ? normalized : null;
}
