import { usageFeatures, type UsageEvent, type UsageFeature, type UsageProvider, type UsageSession } from "./types";

export const usagePeriods = { today: "Today", "7d": "Last 7 days", "30d": "Last 30 days", month: "This month", all: "All recorded usage" } as const;
export type UsagePeriod = keyof typeof usagePeriods;

export function usageDateKey(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function moveDay(key: string, days: number) {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function sumReported(events: UsageEvent[], get: (event: UsageEvent) => number | null | undefined) {
  if (!events.length) return 0;
  const values = events.map(get).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

export function usageTotals(events: UsageEvent[]) {
  const requests = events.filter((event) => event.kind === "request");
  const gemini = requests.filter((event) => event.provider === "gemini");
  const conversations = events.filter((event) => event.kind === "conversation");
  const voice = conversations.filter((event) => event.feature !== "elevenlabs_chat");
  return {
    requests: requests.length,
    failedRequests: requests.filter((event) => event.status === "failed").length,
    pendingRequests: requests.filter((event) => event.status === "pending").length,
    conversations: conversations.length,
    failedConversations: conversations.filter((event) => event.status === "failed").length,
    pendingConversations: conversations.filter((event) => event.status === "pending").length,
    inputTokens: sumReported(gemini, (event) => event.tokens?.input),
    outputTokens: sumReported(gemini, (event) => event.tokens?.output),
    thinkingTokens: sumReported(gemini, (event) => event.tokens?.thinking),
    cachedTokens: sumReported(gemini, (event) => event.tokens?.cached),
    toolTokens: sumReported(gemini, (event) => event.tokens?.tools),
    totalTokens: sumReported(gemini, (event) => event.tokens?.total),
    unreportedTokenRequests: gemini.filter((event) => event.tokens?.total == null).length,
    estimatedGeminiCostUsd: sumReported(gemini, (event) => event.estimatedCost?.usd),
    unpricedGeminiRequests: gemini.filter((event) => event.estimatedCost?.usd == null).length,
    durationSeconds: sumReported(conversations, (event) => event.voice?.durationSeconds),
    voiceSeconds: sumReported(voice, (event) => event.voice?.durationSeconds),
    unreportedVoiceConversations: voice.filter((event) => event.voice?.durationSeconds == null).length,
    credits: sumReported(conversations, (event) => event.voice?.credits),
    costUsd: sumReported(conversations, (event) => event.voice?.costUsd),
    unreportedCreditConversations: conversations.filter((event) => event.voice?.credits == null).length,
    unreportedCostConversations: conversations.filter((event) => event.voice?.costUsd == null).length,
    ttsCharacters: sumReported(conversations, (event) => event.voice?.ttsCharacters),
    audioOutputSeconds: sumReported(conversations, (event) => event.voice?.audioOutputSeconds),
    audioInputSeconds: sumReported(conversations, (event) => event.voice?.audioInputSeconds),
  };
}
export type UsageTotals = ReturnType<typeof usageTotals>;
export type UsageSummary = ReturnType<typeof summarizeUsage>;

function recentRecords(events: UsageEvent[]) {
  return [...events].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 50)
    .map(({ id, provider, feature, kind, operation, model, status, startedAt, recordedAt, latencyMs, httpStatus, tokens, voice, estimatedCost, source, historical }) => ({ id, provider, feature, kind, operation, model, status, startedAt, recordedAt, latencyMs, httpStatus, tokens, voice, estimatedCost, source, historical }));
}

export function summarizeUsage(events: UsageEvent[], sessions: UsageSession[], options: { workspaceId: string; timeZone: string; period: UsagePeriod; now?: Date }) {
  if (events.some((event) => event.workspaceId !== options.workspaceId) || sessions.some((session) => session.workspaceId !== options.workspaceId)) throw new Error("Usage workspace scope mismatch.");
  const now = options.now || new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: options.timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const dateKey = (date: Date) => formatter.format(date);
  const today = dateKey(now);
  const startDate = options.period === "today" ? today : options.period === "month" ? `${today.slice(0, 7)}-01` : options.period === "7d" ? moveDay(today, -6) : options.period === "30d" ? moveDay(today, -29) : null;
  const inRange = (timestamp: string) => {
    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime()) || date > now) return false;
    const key = dateKey(date);
    return !startDate || key >= startDate;
  };
  const filtered = events.filter((event) => inRange(event.startedAt));
  const byDate = new Map<string, UsageEvent[]>();
  for (const event of filtered) {
    const key = dateKey(new Date(event.startedAt));
    const rows = byDate.get(key) || [];
    rows.push(event);
    byDate.set(key, rows);
  }
  const chartStart = startDate || moveDay(today, -29);
  const trackingStartedAt = [...events.filter((event) => !event.historical).map((event) => event.startedAt), ...sessions.filter((session) => !session.trustedUnattributedImport).map((session) => session.createdAt)].sort()[0] || null;
  const earliestRecordAt = [...events.map((event) => event.startedAt), ...sessions.map((session) => session.createdAt)].sort()[0] || null;
  const trackingDate = trackingStartedAt ? dateKey(new Date(trackingStartedAt)) : null;
  const daily: Array<{ date: string; totals: UsageTotals; coverage: "untracked" | "partial" | "recorded" | "imported" }> = [];
  for (let day = chartStart; day <= today; day = moveDay(day, 1)) {
    const rows = byDate.get(day) || [];
    daily.push({ date: day, totals: usageTotals(rows), coverage: !trackingDate || day < trackingDate ? rows.length ? "imported" : "untracked" : day === trackingDate ? "partial" : "recorded" });
  }
  const providers = (["gemini", "elevenlabs"] as const).map((provider) => ({ provider, totals: usageTotals(filtered.filter((event) => event.provider === provider)) }));
  const features = (Object.keys(usageFeatures) as UsageFeature[]).map((feature) => ({
    feature, label: usageFeatures[feature], provider: (["website_generation", "website_chat", "call_chat", "appointment_extraction"].includes(feature) ? "gemini" : "elevenlabs") as UsageProvider,
    totals: usageTotals(filtered.filter((event) => event.feature === feature)),
  }));
  return {
    period: options.period, timeZone: options.timeZone, startDate, endDate: today, refreshedAt: now.toISOString(),
    trackingStartedAt, earliestRecordAt,
    totals: usageTotals(filtered), providers, features, daily,
    pendingSessions: sessions.filter((session) => inRange(session.createdAt) && (!session.complete || Boolean(session.recheckRequestedAt && session.recheckRequestedAt > (session.providerCheckedAt || "")))).length,
    sessionSyncErrors: sessions.filter((session) => !session.complete && session.syncError).length,
    recent: recentRecords(filtered),
    recentByProvider: { gemini: recentRecords(filtered.filter((event) => event.provider === "gemini")), elevenlabs: recentRecords(filtered.filter((event) => event.provider === "elevenlabs")) },
    totalRecords: filtered.length,
  };
}
