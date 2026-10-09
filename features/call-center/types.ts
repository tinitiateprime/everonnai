// Shared Live Agent Desk types: the server sends these shapes to the desk UI.
// Every interaction-bearing payload carries the client (tenant) and line
// identity so no screen can render interaction data without them (HIL-017).

export type Channel = "voice" | "chat" | "sms";
export type HandlingChannel = Channel | "callback";
export type Severity = 1 | 2 | 3 | 4;
export type PresenceStatus = "available" | "on_call" | "wrap_up" | "away" | "break" | "offline";
export type OperatorRole = "operator" | "operator_lead";
export type EscalationState = "created" | "notified" | "acknowledged" | "in_progress" | "escalated" | "resolved" | "auto_resolved" | "reviewed" | "closed";
export type OfferOutcome = "pending" | "accepted" | "declined" | "timed_out" | "cancelled";
export type HandlingState = "accepted" | "connecting" | "active" | "on_hold" | "ended" | "wrap_up" | "completed" | "failed";
export type AuthorityLevel = "allowed" | "requires_owner_approval" | "not_allowed";
export type HoursMode = "business_hours" | "after_hours" | "callback" | "outbound";
export type Disposition = "resolved" | "message_taken" | "transferred_to_owner" | "callback_scheduled" | "handed_back_to_ai" | "spam" | "wrong_number" | "other";

export const authorityCapabilities = [
  ["quote", "Quote a price"],
  ["commit_eta", "Commit an arrival time"],
  ["book", "Book an appointment"],
  ["dispatch", "Dispatch a technician"],
  ["payment_link", "Take payment by link"],
  ["cancel_reschedule", "Cancel or reschedule"],
  ["share_technician", "Share technician details"],
  ["grant_exception", "Grant an exception"],
] as const;
export type AuthorityCapability = (typeof authorityCapabilities)[number][0];
export type AuthorityMatrix = Partial<Record<AuthorityCapability, AuthorityLevel>>;

export const dispositions: ReadonlyArray<[Disposition, string]> = [
  ["resolved", "Resolved"],
  ["message_taken", "Message taken"],
  ["transferred_to_owner", "Transferred to owner"],
  ["callback_scheduled", "Callback scheduled"],
  ["handed_back_to_ai", "Handed back to AI"],
  ["spam", "Spam"],
  ["wrong_number", "Wrong number"],
  ["other", "Other"],
];

export type CapturedField = { field: string; label?: string; value: string | null; confidence: number; confirmed: boolean };
export type CoverageWindow = { days: number[]; start: string; end: string };

export type ClientIdentity = {
  tenantId: string;
  name: string;
  spokenName: string;
  pronunciation: string | null;
  brandColor: string;
  brandName: string;
  status: "open" | "after_hours";
  timeZone: string;
};

export type LineIdentity = { lineId: string; label: string; numberE164: string | null; kind: Channel; resolution: "exact" };

export type InteractionContext = {
  client: ClientIdentity;
  line: LineIdentity;
  escalation: { id: string; severity: Severity; trigger: string; triggerDetail: string | null; state: EscalationState; language: string; channel: Channel; createdAt: string; slaDueAt: string; cascadeStep: number };
  greeting: { scriptId: string | null; version: number | null; text: string; hoursMode: HoursMode };
  announcement: { enabled: boolean; text: string };
  caller: { contactId: string | null; name: string | null; numberE164: string | null; returning: boolean; priorInteractions: number; vip: boolean; language: string };
  ai: { summary: string | null; captured: CapturedField[] };
  request: { id: string; version: number; status: string; urgency: string; serviceType: string | null; summary: string | null; fields: CapturedField[] } | null;
  transcript: Array<{ id: string; speaker: "caller" | "ai" | "operator" | "system"; text: string; at: string }>;
  authority: AuthorityMatrix;
  instructions: { ownerNotes: string | null; vipList: string[]; blockedAddresses: string[]; special: string[]; doNotSay: string[] };
  business: { hours: string | null; services: string[]; serviceArea: string | null; pricingPolicy: string | null; paymentMethods: string[] };
  transferContacts: Array<{ id: string; name: string; role: string; maskedNumber: string; onCall: boolean }>;
  callerHistory: Array<{ conversationId: string; channel: Channel; startedAt: string; summary: string | null }>;
  playbookSlots: Array<{ field: string; label: string; required: boolean }>;
  cannedReplies: string[];
  requiredWrapFields: string[];
  approvals: Array<{ id: string; capability: string; state: string; detail: string; decisionNote: string | null }>;
};

export type OfferCard = InteractionContext & { offerId: string; offeredAt: string; expiresAt: string };

export type ActiveInteraction = InteractionContext & {
  handlingId: string;
  channel: HandlingChannel;
  state: HandlingState;
  muted: boolean;
  acceptedAt: string | null;
  connectedAt: string | null;
  holdStartedAt: string | null;
  greetingDelivered: boolean;
  wrapDueAt: string | null;
  transferredTo: string | null;
  version: number;
};

export type QueueItem = {
  key: string;
  kind: "escalation" | "callback" | "approval" | "unknown_line";
  tenantId: string | null;
  clientName: string;
  brandColor: string;
  lineLabel: string;
  channel: HandlingChannel;
  severity: Severity;
  language: string;
  waitingSince: string;
  dueAt: string;
  status: string;
  detail: string;
  taskId?: string;
  incidentId?: string;
};

export type OperatorSummary = {
  operatorId: string;
  displayName: string;
  firstName: string;
  role: OperatorRole;
  languages: string[];
  maxVoice: number;
  maxChat: number;
  presence: PresenceStatus;
  presenceSince: string;
  shiftOpen: boolean;
};

export type OperatorStats = { handledToday: number; avgHandleSeconds: number | null; greetingCompliance: number | null; wrongClient: number; qaAverage: number | null };

export type DeskSnapshot = {
  serverTime: string;
  superseded: boolean;
  operator: OperatorSummary;
  offers: OfferCard[];
  active: ActiveInteraction[];
  queue: QueueItem[];
  stats: OperatorStats;
};

export type DeskCommandType =
  | "session.start" | "shift.start" | "shift.end" | "presence.set"
  | "offer.accept" | "offer.decline"
  | "call.connected" | "greeting.delivered" | "call.hold" | "call.resume" | "call.mute" | "call.transfer" | "call.handback" | "call.end"
  | "chat.reply" | "request.update" | "authority.act" | "callback.schedule" | "callback.start" | "wrongclient.report" | "wrapup.submit"
  | "approval.decide" | "incident.acknowledge" | "grant.upsert" | "grant.revoke" | "qa.submit" | "simulate.inbound";

export type DeskCommand = { type: DeskCommandType; id: string; payload: Record<string, unknown> };
export type DeskErrorCode = "not_granted" | "offer_expired" | "already_assigned" | "authority_denied" | "client_mismatch" | "invalid_state" | "rate_limited" | "session_superseded" | "not_found" | "forbidden" | "invalid_input" | "capacity";

export type WallboardData = {
  serverTime: string;
  clients: Array<{ tenantId: string; name: string; brandColor: string; waiting: number; urgentWaiting: number; oldestWaitingSince: string | null; breached: number; activeHandlings: number }>;
  operators: Array<{ operatorId: string; name: string; role: OperatorRole; presence: PresenceStatus; since: string; languages: string[]; activeClients: string[]; lastHeartbeatAt: string | null }>;
  totals: { waiting: number; active: number; serviceLevel: number | null; abandonRate: number | null; wrongClientRate: number | null; handledToday: number };
  approvals: Array<{ id: string; tenantId: string; clientName: string; capability: string; detail: string; requestedBy: string; createdAt: string }>;
  reviewable: Array<{ handlingId: string; tenantId: string; clientName: string; operatorName: string; channel: HandlingChannel; disposition: string | null; endedAt: string | null; greetingDelivered: boolean; reviewed: boolean }>;
};

export type RosterData = {
  operators: Array<{ operatorId: string; name: string; email: string; role: OperatorRole; languages: string[]; status: string }>;
  clients: Array<{ tenantId: string; name: string; brandColor: string; vertical: string; deskMode: string; lines: Array<{ lineId: string; label: string; numberE164: string | null; kind: Channel }> }>;
  grants: Array<{ operatorId: string; tenantId: string; skills: string[]; trainingCompletedAt: string | null; certifiedAt: string | null; expiresAt: string | null; revokedAt: string | null; active: boolean }>;
};

export type ClientDirectoryEntry = {
  tenantId: string;
  name: string;
  spokenName: string;
  pronunciation: string | null;
  brandColor: string;
  status: "open" | "after_hours";
  timeZone: string;
  operatorNotes: string | null;
  authority: AuthorityMatrix;
  greetings: Array<{ language: string; hoursMode: HoursMode; version: number; text: string }>;
  business: InteractionContext["business"];
  lines: Array<{ label: string; kind: Channel; numberE164: string | null }>;
};
