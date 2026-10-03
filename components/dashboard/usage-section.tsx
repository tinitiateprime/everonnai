"use client";

import { Activity, Bot, Coins, Headphones, RefreshCw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { usagePeriods, type UsagePeriod, type UsageSummary, type UsageTotals } from "@/features/usage/summary";
import { usageFeatures, type UsageProvider } from "@/features/usage/types";

const number = (value: number | null) => value === null ? "Unavailable" : new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(value);
const dollars = (value: number | null) => value === null ? "Unavailable" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value);
const duration = (value: number | null) => value === null ? "Unavailable" : `${number(value / 60)} min`;
const providerName = (provider: UsageProvider) => provider === "gemini" ? "Gemini" : "ElevenLabs";
function dateTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en", { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

type ChartMetric = "requests" | "totalTokens" | "voiceSeconds" | "credits";
const chartMetrics: Record<ChartMetric, string> = { requests: "API requests", totalTokens: "Gemini tokens", voiceSeconds: "Voice minutes", credits: "ElevenLabs credits" };

export function UsageSection({ workspaceId }: { workspaceId: string }) {
  const [period, setPeriod] = useState<UsagePeriod>("month");
  const [provider, setProvider] = useState<UsageProvider | "all">("all");
  const [metric, setMetric] = useState<ChartMetric>("requests");
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [syncError, setSyncError] = useState("");
  const requestSequence = useRef(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++requestSequence.current;
    try {
      const response = await fetch(`/api/usage?period=${period}`, { cache: "no-store", signal });
      const data = await response.json() as { summary?: UsageSummary; error?: string };
      if (!response.ok || !data.summary) throw new Error(data.error || "Usage could not be loaded.");
      if (sequence === requestSequence.current && !signal?.aborted) { setSummary(data.summary); setError(""); }
    } catch (cause) {
      if (sequence === requestSequence.current && !signal?.aborted) setError(cause instanceof Error ? cause.message : "Usage could not be loaded.");
    } finally {
      if (sequence === requestSequence.current && !signal?.aborted) setLoading(false);
    }
  }, [period]);

  const synchronize = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/usage/sync", { method: "POST", signal });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "ElevenLabs usage could not be synchronized.");
      if (!signal?.aborted) setSyncError(data.error || "");
    } catch (cause) {
      if (!signal?.aborted) setSyncError(cause instanceof Error ? cause.message : "ElevenLabs usage could not be synchronized.");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const initial = setTimeout(() => {
      void load(controller.signal);
      void synchronize(controller.signal).then(() => { if (!controller.signal.aborted) void load(controller.signal); });
    }, 0);
    const poll = setInterval(() => { if (document.visibilityState === "visible") void load(controller.signal); }, 15_000);
    const sync = setInterval(() => { if (document.visibilityState === "visible") void synchronize(controller.signal).then(() => load(controller.signal)); }, 60_000);
    return () => { controller.abort(); clearTimeout(initial); clearInterval(poll); clearInterval(sync); };
  }, [load, synchronize, workspaceId]);

  async function refresh() {
    setRefreshing(true);
    await synchronize();
    await load();
    setRefreshing(false);
  }

  const totals = summary?.totals;
  const features = summary?.features.filter((entry) => provider === "all" || entry.provider === provider) || [];
  const recent = summary ? provider === "all" ? summary.recent : summary.recentByProvider[provider] : [];
  const recentCount = !summary ? 0 : provider === "all" ? summary.totalRecords : summary.providers.filter((entry) => entry.provider === provider).reduce((sum, entry) => sum + entry.totals.requests + entry.totals.conversations, 0);
  const chartValue = (total: UsageTotals) => metric === "voiceSeconds" ? (total.voiceSeconds === null ? null : total.voiceSeconds / 60) : total[metric];
  const max = Math.max(1, ...(summary?.daily.map((day) => chartValue(day.totals) || 0) || []));

  return <div className="eo-provider-usage">
    <div className="eo-page-heading"><div><span>Provider usage</span><h1>See where your AI usage goes.</h1><p>Gemini tokens and ElevenLabs voice and chat usage, measured for this business workspace.</p></div><button className="eo-secondary-button" onClick={() => void refresh()} disabled={refreshing} aria-busy={refreshing}><RefreshCw className={refreshing ? "eo-usage-spinning" : ""} />{refreshing ? "Refreshing…" : "Refresh usage"}</button></div>
    <div className="eo-usage-controls"><label>Reporting period<select value={period} onChange={(event) => { setLoading(true); setSummary(null); setPeriod(event.target.value as UsagePeriod); }}>{Object.entries(usagePeriods).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label><p>{summary ? `Updated ${dateTime(summary.refreshedAt, summary.timeZone)} · ${summary.timeZone}` : "Loading recorded usage…"}<small>Auto-refreshes every 15 seconds. ElevenLabs syncs every minute.</small></p></div>
    {error && <div className="eo-usage-notice" role="alert">{error} <button onClick={() => void load()}>Retry</button>{summary && <small>Showing the last successfully loaded records.</small>}</div>}
    {syncError && <div className="eo-usage-notice" role="status">{syncError}<small>Recorded usage is still shown. New conversation charges may be pending.</small></div>}
    {loading && !summary && <p role="status">Loading provider usage…</p>}
    {summary && totals && <>
      <div className="eo-metrics eo-usage-metrics">
        <article><span><Activity /></span><div><small>API requests</small><strong>{number(totals.requests)}</strong><p>{number(totals.failedRequests)} failed · {number(totals.pendingRequests)} pending</p></div></article>
        <article><span><Sparkles /></span><div><small>Gemini tokens</small><strong>{number(totals.totalTokens)}</strong><p>{totals.unreportedTokenRequests ? `${totals.unreportedTokenRequests} requests without reported totals` : "Provider-reported total, including thinking"}</p></div></article>
        <article><span><Headphones /></span><div><small>Voice conversation time</small><strong>{duration(totals.voiceSeconds)}</strong><p>{number(totals.conversations)} voice and live chat conversations</p></div></article>
        <article><span><Coins /></span><div><small>ElevenLabs credits</small><strong>{number(totals.credits)}</strong><p>{totals.unreportedCreditConversations ? `${totals.unreportedCreditConversations} conversations awaiting credit totals` : "Provider-reported conversation charges"}</p></div></article>
      </div>
      <div className="eo-usage-provider-grid">
        {summary.providers.map(({ provider: name, totals: values }) => <article className={`eo-panel eo-usage-provider eo-usage-${name}`} key={name}><div className="eo-panel-heading"><div><span>{name === "gemini" ? "Generation & reasoning" : "Voice & live chat"}</span><h2>{providerName(name)}</h2></div>{name === "gemini" ? <Bot /> : <Headphones />}</div><dl>
          {name === "gemini" ? <><div><dt>Input tokens</dt><dd>{number(values.inputTokens)}</dd></div><div><dt>Output tokens</dt><dd>{number(values.outputTokens)}</dd></div><div><dt>Thinking tokens</dt><dd>{number(values.thinkingTokens)}</dd></div><div><dt>Cached input tokens</dt><dd>{number(values.cachedTokens)}</dd></div><div><dt>Tool prompt tokens</dt><dd>{number(values.toolTokens)}</dd></div><div><dt>Generation attempts</dt><dd>{number(values.requests)}</dd></div></> : <><div><dt>Conversations</dt><dd>{number(values.conversations)}</dd></div><div><dt>Reported cost (USD)</dt><dd>{dollars(values.costUsd)}</dd></div><div><dt>Speech characters</dt><dd>{number(values.ttsCharacters)}</dd></div><div><dt>Audio generated</dt><dd>{duration(values.audioOutputSeconds)}</dd></div><div><dt>Audio transcribed</dt><dd>{duration(values.audioInputSeconds)}</dd></div><div><dt>Session setup requests</dt><dd>{number(values.requests)}</dd></div></>}
        </dl><p>{name === "gemini" ? "Cached tokens are part of input; the provider total includes thinking. Gemini charges are available in Google billing." : `${values.pendingConversations} conversations in progress or processing.${values.unreportedCostConversations ? ` ${values.unreportedCostConversations} without a reported USD cost.` : ""} Speech metrics are analytics, separate from credit charges.`}</p></article>)}
      </div>
      <section className="eo-panel eo-usage-chart-panel"><div className="eo-panel-heading"><div><span>Daily activity{period === "all" ? " · last 30 days" : ""}</span><h2>Usage over time</h2></div><label className="eo-usage-chart-select"><span className="sr-only">Chart metric</span><select value={metric} onChange={(event) => setMetric(event.target.value as ChartMetric)}>{Object.entries(chartMetrics).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div><div className="eo-usage-chart" role="group" aria-label={`Daily ${chartMetrics[metric]} in ${summary.timeZone}. Hover or focus on a day for its recorded value.`}>{summary.daily.map((day, index) => {
        const value = chartValue(day.totals);
        const label = `${day.date}: ${number(value)} ${chartMetrics[metric].toLowerCase()}`;
        return <div className="eo-usage-chart-day" key={day.date} title={label} aria-label={label} tabIndex={0}><div><i style={{ height: `${value ? Math.max(3, value / max * 100) : 0}%` }} /></div><small>{summary.daily.length <= 7 || index === 0 || index === summary.daily.length - 1 || index % 7 === 0 ? day.date.slice(5).replace("-", "/") : ""}</small></div>;
      })}</div></section>
      <section className="eo-panel"><div className="eo-panel-heading"><div><span>By feature</span><h2>What each feature uses</h2></div><label className="eo-usage-chart-select"><span className="sr-only">Filter provider</span><select value={provider} onChange={(event) => setProvider(event.target.value as UsageProvider | "all")}><option value="all">All providers</option><option value="gemini">Gemini</option><option value="elevenlabs">ElevenLabs</option></select></label></div><div className="eo-table-wrap"><table className="eo-table eo-usage-table"><thead><tr><th>Feature</th><th>API requests</th><th>Failed requests</th><th>Conversations</th><th>Tokens</th><th>Duration</th><th>Credits</th><th>Cost (USD)</th></tr></thead><tbody>{features.map((entry) => <tr key={entry.feature}><td><strong>{entry.label}</strong><small>{providerName(entry.provider)}</small></td><td>{number(entry.totals.requests)}</td><td>{number(entry.totals.failedRequests)}</td><td>{entry.provider === "elevenlabs" ? number(entry.totals.conversations) : "—"}</td><td>{entry.provider === "gemini" ? <>{number(entry.totals.totalTokens)}{entry.totals.unreportedTokenRequests > 0 && <small>{entry.totals.unreportedTokenRequests} unreported</small>}</> : "—"}</td><td>{entry.provider === "elevenlabs" ? duration(entry.totals.durationSeconds) : "—"}</td><td>{entry.provider === "elevenlabs" ? <>{number(entry.totals.credits)}{entry.totals.unreportedCreditConversations > 0 && <small>{entry.totals.unreportedCreditConversations} awaiting totals</small>}</> : "—"}</td><td>{entry.provider === "elevenlabs" ? <>{dollars(entry.totals.costUsd)}{entry.totals.unreportedCostConversations > 0 && <small>{entry.totals.unreportedCostConversations} unreported</small>}</> : "—"}</td></tr>)}</tbody></table></div></section>
      <section className="eo-panel eo-usage-recent"><div className="eo-panel-heading"><div><span>Recent activity</span><h2>Latest recorded requests & conversations</h2></div><small>Latest {recent.length} of {number(recentCount)} records</small></div>{recent.length ? <div className="eo-table-wrap"><table className="eo-table eo-usage-table"><thead><tr><th>Time</th><th>Feature / operation</th><th>Provider / model</th><th>Status</th><th>Usage</th></tr></thead><tbody>{recent.map((entry) => <tr key={entry.id}><td>{dateTime(entry.startedAt, summary.timeZone)}</td><td><strong>{usageFeatures[entry.feature]}</strong><small>{entry.operation}</small></td><td><strong>{providerName(entry.provider)}</strong><small className="eo-usage-model" title={entry.model}>{entry.model}</small></td><td><span className={`eo-status eo-status-${entry.status === "success" ? "good" : entry.status === "failed" ? "danger" : "warning"}`}>{entry.status === "pending" ? "Pending" : entry.status === "success" ? "Success" : "Failed"}{entry.httpStatus !== null ? ` · ${entry.httpStatus}` : ""}</span></td><td>{entry.provider === "gemini" ? `${number(entry.tokens?.total ?? null)} tokens` : entry.kind === "conversation" ? <>{duration(entry.voice?.durationSeconds ?? null)}<small>{number(entry.voice?.credits ?? null)} credits</small></> : "Session setup"}</td></tr>)}</tbody></table></div> : <p className="eo-empty">No usage recorded for this period and provider. Generate a website or use AI chat or voice to begin metering.</p>}</section>
      <div className="eo-usage-footnote"><p>{summary.pendingSessions > 0 ? `${summary.pendingSessions} issued sessions still awaiting provider reconciliation. ` : ""}The meter shows usage recorded by EverOnn for this workspace. {summary.trackingStartedAt ? `Recording started ${dateTime(summary.trackingStartedAt, summary.timeZone)}.` : "Recording begins with your next provider request."} Earlier Gemini calls and usage outside EverOnn are excluded.</p><p>Each retry is a separate API request. ElevenLabs session credentials count as setup requests; a conversation counts when the provider reports it. Missing metrics show Unavailable. Credits and USD costs are reported by ElevenLabs, and can arrive after a conversation ends.</p></div>
    </>}
  </div>;
}
