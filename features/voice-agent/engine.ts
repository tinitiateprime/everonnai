import type { TranscriptMessage, Urgency } from "@/features/everonn/types";

function clean(value: unknown, max = 1200) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

export function detectUrgency(value: string): Urgency {
  const actual = value.replace(/\b(not urgent|no emergency|not an emergency|non-emergency)\b/gi, " ");
  if (/\b(emergency|urgent|immediately|right away|danger|fire|flood|burst|gas leak|smell (?:of )?gas|gas (?:smell|odor|odour)|carbon monoxide|not breathing|sparks?|sparking|smoke|smoking)\b/i.test(actual)) return "high";
  if (/\b(no rush|not urgent|whenever|next week|sometime)\b/i.test(value)) return "low";
  return "normal";
}

function extractEmail(value: string) {
  const written = [...value.matchAll(/\b[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+\b/gi)].at(-1)?.[0];
  if (written) return written.toLowerCase();

  const spoken = value
    .replace(/\s+(?:at sign|at)\s+/gi, "@")
    .replace(/\s+(?:dot|point)\s+/gi, ".");
  const lastAt = spoken.lastIndexOf("@");
  if (lastAt < 1) return "";
  const local = spoken.slice(0, lastAt).match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i)?.[0] || "";
  const domain = spoken.slice(lastAt + 1).match(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?/i)?.[0] || "";
  const candidate = `${local}@${domain}`.toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,63}$/i.test(candidate) ? candidate : "";
}

export function extractCallerDetails(messages: TranscriptMessage[]) {
  const callerText = messages.filter((item) => item.role === "caller").map((item) => item.text).join(" ");
  const withoutDates = callerText.replace(/\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?\b/g, " ").replace(/\b\d{1,2}:\d{2}\s*(?:[ap]\.?m\.?)?/gi, " ");
  const phone = [...withoutDates.matchAll(/(?:\+?\d[\d ()-]{6,}\d)/g)].map((match) => match[0].trim()).filter((value) => {
    const digits = value.replace(/\D/g, "").length;
    return digits >= 7 && digits <= 15;
  }).at(-1) || "";
  const names = [...callerText.matchAll(/\b(?:my name is|this is|i am|i'm|name\s*(?:is|:))\s+([a-z][a-z.'-]*(?:\s+[a-z][a-z.'-]*){0,2}?)(?=\s+(?:and\b|my\b|email\b|phone\b|number\b|calling\b|about\b|because\b)|[,.!?]|$)/gi)].map((match) => match[1]).filter((name) => !/^(looking|calling|interested|trying|booking|available|requesting|hoping|having|urgent|an emergency|a customer)\b/i.test(name));
  const callerName = clean(names.at(-1), 120);
  return { callerName, callerPhone: clean(phone, 40), callerEmail: clean(extractEmail(callerText), 254), urgency: detectUrgency(callerText) };
}
