export const usageFeatures = {
  website_generation: "Website generation",
  website_chat: "Website chat",
  call_chat: "Call assistant text",
  appointment_extraction: "Appointment extraction",
  dashboard_voice: "Dashboard voice calls",
  website_voice: "Website voice calls",
  elevenlabs_chat: "Website live chat",
} as const;

export type UsageFeature = keyof typeof usageFeatures;
export type UsageProvider = "gemini" | "elevenlabs";
export type UsageContext = { workspaceId: string; feature: UsageFeature };
export type GeminiTokens = {
  input: number | null;
  output: number | null;
  thinking: number | null;
  cached: number | null;
  tools: number | null;
  total: number | null;
};
export type ElevenLabsMetrics = {
  durationSeconds: number | null;
  credits: number | null;
  costUsd: number | null;
  ttsCharacters: number | null;
  audioOutputSeconds: number | null;
  audioInputSeconds: number | null;
};
export type UsageEvent = UsageContext & {
  id: string;
  provider: UsageProvider;
  kind: "request" | "conversation";
  operation: string;
  model: string;
  status: "success" | "failed" | "pending";
  startedAt: string;
  recordedAt: string;
  latencyMs: number | null;
  httpStatus: number | null;
  tokens: GeminiTokens | null;
  voice: ElevenLabsMetrics | null;
};

// Opaque server-issued identity is passed as the ElevenLabs userId. It is never
// included in dashboard summaries, and carries no customer or transcript data.
export type UsageSession = UsageContext & {
  id: string;
  agentId: string;
  createdAt: string;
  conversationIds: string[];
  syncedAt: string | null;
  complete: boolean;
};

export function nonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
