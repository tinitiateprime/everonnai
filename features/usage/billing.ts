import { createSign } from "node:crypto";
import { readGeminiBilling, saveGeminiBilling } from "@/lib/usage-store";
import { usageDateKey, type UsagePeriod } from "./summary";
import type { GeminiBillingReport } from "./types";

export function geminiBillingConfigured() {
  return ["GEMINI_BILLING_SERVICE_ACCOUNT_BASE64", "GEMINI_BILLING_TABLE", "GEMINI_BILLING_PROJECT_ID", "GEMINI_BILLING_SERVICE_ID", "GEMINI_BILLING_WORKSPACE_ID"].every((key) => Boolean(process.env[key]));
}

export function billingQuery(table: string, projectId: string, serviceId: string, timeZone: string) {
  if (!/^[a-z][a-z0-9-]{4,62}\.[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/.test(table)) throw new Error("Invalid billing export table.");
  new Intl.DateTimeFormat("en", { timeZone });
  return {
    query: `SELECT FORMAT_DATE('%F', DATE(usage_start_time, @timeZone)) AS usage_date, currency, SUM(cost + IFNULL((SELECT SUM(credit.amount) FROM UNNEST(credits) AS credit), 0)) AS amount FROM \`${table}\` WHERE project.id = @projectId AND service.id = @serviceId AND usage_start_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 365 DAY) GROUP BY usage_date, currency ORDER BY usage_date, currency`,
    useLegacySql: false, maximumBytesBilled: "1000000000", timeoutMs: 1000,
    parameterMode: "NAMED", queryParameters: Object.entries({ timeZone, projectId, serviceId }).map(([name, value]) => ({ name, parameterType: { type: "STRING" }, parameterValue: { value } })),
  };
}

type QueryResult = { jobComplete?: boolean; jobReference?: { jobId: string; location?: string }; pageToken?: string; errors?: unknown[]; rows?: Array<{ f: Array<{ v: string }> }> };
export function billingRows(payload: QueryResult) {
  return (payload.rows || []).map((row) => {
    const [date, currency, rawAmount] = row.f.map((field) => field.v);
    const amount = Number(rawAmount);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^[A-Z]{3}$/.test(currency) || typeof rawAmount !== "string" || !rawAmount.trim() || !Number.isFinite(amount)) throw new Error("Invalid billing export row.");
    return { date, currency, amount };
  });
}

export async function syncGeminiBilling(fetchImpl: typeof fetch = fetch) {
  if (!geminiBillingConfigured()) return { configured: false, error: null };
  const workspaceId = process.env.GEMINI_BILLING_WORKSPACE_ID!;
  const previous = await readGeminiBilling(workspaceId);
  if (previous && Date.now() - Date.parse(previous.refreshedAt) < 60 * 60_000) return { configured: true, error: previous.error };
  const timeZone = process.env.GEMINI_BILLING_TIME_ZONE || "UTC";
  const refreshedAt = new Date().toISOString();
  const first = new Date(Date.now() - 365 * 24 * 60 * 60_000);
  const coverageStart = usageDateKey(first, timeZone);
  try {
    const credential = JSON.parse(Buffer.from(process.env.GEMINI_BILLING_SERVICE_ACCOUNT_BASE64!, "base64").toString("utf8")) as { client_email: string; private_key: string };
    if (!credential.client_email?.endsWith(".gserviceaccount.com") || !credential.private_key) throw new Error("Invalid billing credential.");
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const issued = Math.floor(Date.now() / 1000);
    const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iss: credential.client_email, scope: "https://www.googleapis.com/auth/bigquery", aud: "https://oauth2.googleapis.com/token", iat: issued, exp: issued + 3600 })}`;
    const signature = createSign("RSA-SHA256").update(unsigned).sign(credential.private_key, "base64url");
    const signal = AbortSignal.timeout(25_000);
    const tokenResponse = await fetchImpl("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }), signal, cache: "no-store" });
    const token = await tokenResponse.json() as { access_token?: string };
    if (!tokenResponse.ok || !token.access_token) throw new Error("Billing authentication failed.");
    const table = process.env.GEMINI_BILLING_TABLE!;
    const query = billingQuery(table, process.env.GEMINI_BILLING_PROJECT_ID!, process.env.GEMINI_BILLING_SERVICE_ID!, timeZone);
    const queryProject = table.split(".")[0];
    const api = `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(queryProject)}/queries`;
    const headers = { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" };
    async function request(url: string, init?: RequestInit) {
      const response = await fetchImpl(url, { ...init, headers, signal, cache: "no-store" });
      const payload = await response.json() as QueryResult;
      if (!response.ok || payload.errors?.length) throw new Error("Billing export query failed.");
      return payload;
    }
    let payload = await request(api, { method: "POST", body: JSON.stringify(query) });
    const job = payload.jobReference;
    for (let attempt = 0; !payload.jobComplete; attempt++) {
      if (!job || attempt >= 4) throw new Error("Billing export query is not ready.");
      payload = await request(`${api}/${encodeURIComponent(job.jobId)}?timeoutMs=2000${job.location ? `&location=${encodeURIComponent(job.location)}` : ""}`);
    }
    const days = billingRows(payload);
    const cursors = new Set<string>();
    while (payload.pageToken) {
      if (!job || cursors.has(payload.pageToken)) throw new Error("Billing pagination could not be completed.");
      cursors.add(payload.pageToken);
      payload = await request(`${api}/${encodeURIComponent(job.jobId)}?pageToken=${encodeURIComponent(payload.pageToken)}${job.location ? `&location=${encodeURIComponent(job.location)}` : ""}`);
      days.push(...billingRows(payload));
    }
    await saveGeminiBilling({ workspaceId, refreshedAt, timeZone, coverageStart, days, error: null, lastSuccessfulAt: refreshedAt });
    return { configured: true, error: null };
  } catch {
    const error = "Gemini billing export could not be synchronized. Check billing export configuration and BigQuery permissions.";
    await saveGeminiBilling({ workspaceId, refreshedAt, timeZone, coverageStart: previous?.coverageStart || coverageStart, days: previous?.days || [], error, lastSuccessfulAt: previous?.lastSuccessfulAt || null });
    return { configured: true, error };
  }
}

export function summarizeBilling(report: GeminiBillingReport | null, workspaceId: string, period: UsagePeriod, now = new Date()) {
  if (!report) return { connected: false as const, totals: [], refreshedAt: null, timeZone: null, coverageStart: null, error: null };
  if (report.workspaceId !== workspaceId) throw new Error("Billing workspace scope mismatch.");
  const today = usageDateKey(now, report.timeZone);
  const start = new Date(`${today}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (period === "7d" ? 6 : 29));
  const first = period === "today" ? today : period === "month" ? `${today.slice(0, 7)}-01` : period === "all" ? report.coverageStart : start.toISOString().slice(0, 10);
  const totals = new Map<string, number>();
  for (const day of report.days) if (day.date >= first && day.date <= today) totals.set(day.currency, (totals.get(day.currency) || 0) + day.amount);
  return { connected: Boolean(report.lastSuccessfulAt || report.days.length), totals: [...totals].map(([currency, amount]) => ({ currency, amount })), refreshedAt: report.refreshedAt, timeZone: report.timeZone, coverageStart: report.coverageStart, error: report.error };
}
