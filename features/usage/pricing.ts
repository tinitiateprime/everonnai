import type { GeminiTokens, UsageEvent } from "./types";

// Standard text generateContent rates, USD per million tokens. Verified against
// https://ai.google.dev/gemini-api/docs/pricing on 2026-10-03. Never apply text
// prices to unknown model aliases, audio, tools, or provider invoice amounts.
type Rate = { input: number; output: number; cached: number; long?: { above: number; input: number; output: number; cached: number } };
const rates: Record<string, Rate> = {
  "gemini-2.5-flash": { input: 0.30, output: 2.50, cached: 0.03 },
  "gemini-2.5-flash-lite": { input: 0.10, output: 0.40, cached: 0.01 },
  "gemini-2.5-pro": { input: 1.25, output: 10, cached: 0.125, long: { above: 200_000, input: 2.50, output: 15, cached: 0.25 } },
  "gemini-3.1-flash-lite": { input: 0.25, output: 1.50, cached: 0.025 },
  "gemini-3.5-flash-lite": { input: 0.30, output: 2.50, cached: 0.03 },
  "gemini-3.5-flash": { input: 1.50, output: 9, cached: 0.15 },
  "gemini-3.6-flash": { input: 0.75, output: 3.75, cached: 0.075 },
  "gemini-3.7-flash": { input: 0.75, output: 3.75, cached: 0.075 },
  "gemini-3.8-flash": { input: 0.75, output: 3.75, cached: 0.075 },
  "gemini-3.1-pro-preview": { input: 2, output: 12, cached: 0.20, long: { above: 200_000, input: 4, output: 18, cached: 0.40 } },
};

export function estimateGeminiCost(model: string, tokens: GeminiTokens | null, options: { tier?: string; timestamp?: string } = {}): NonNullable<UsageEvent["estimatedCost"]> {
  const unknown = (basis: string) => ({ usd: null, basis, ratesDate: null });
  const tier = options.tier || process.env.GEMINI_BILLING_TIER || "list-price";
  if (!["paid", "free", "list-price"].includes(tier)) return unknown("Configure a valid Gemini billing tier.");
  if (!tokens || tokens.input === null || tokens.total === null) return unknown("Provider token counts are missing.");
  if (tokens.tools) return unknown("Tool charges require separate pricing.");
  // Compute combined generated/thinking tokens from the provider total when
  // optional breakdown fields are absent, without counting thought tokens twice.
  const output = tokens.total - tokens.input;
  const cached = tokens.cached ?? 0;
  if (output < 0 || cached > tokens.input || (tokens.output ?? 0) + (tokens.thinking ?? 0) > output) return unknown("Provider token counts cannot be reconciled.");
  let rate = rates[model.replace(/^models\//, "")];
  if (!rate) return unknown("No verified rate for this model.");
  if (tier === "free") {
    if (model.includes("pro-preview")) return unknown("This model has no verified free tier.");
    return { usd: 0, basis: "Configured free tier; excludes services outside token generation.", ratesDate: "2026-10-03" };
  }
  const timestamp = options.timestamp || new Date().toISOString();
  if (timestamp < "2026-10-03") return unknown("Historical rates require a billing export.");
  if (/^gemini-3\.[678]-flash$/.test(model) && timestamp >= "2027-01-01") rate = { input: 1.50, output: 7.50, cached: 0.15 };
  else if (timestamp >= "2027-01-01") return unknown("Pricing must be reviewed for this date.");
  const selected = rate.long && tokens.input > rate.long.above ? rate.long : rate;
  return { usd: ((tokens.input - cached) * selected.input + cached * selected.cached + output * selected.output) / 1_000_000, basis: tier === "list-price" ? "Paid-tier list-price estimate; billing tier unverified. Excludes tax, discounts, tools, and cache storage." : "Estimated standard text token cost; excludes tax, discounts, tools, and cache storage.", ratesDate: "2026-10-03" };
}
