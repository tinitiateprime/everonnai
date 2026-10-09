import type { HandlingChannel, Severity } from "@/features/call-center/types";

export function duration(fromIso: string | null, now: number) {
  if (!fromIso || !now) return "0:00";
  const seconds = Math.max(0, Math.floor((now - Date.parse(fromIso)) / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours ? `${hours}:${pad(minutes % 60)}:${pad(seconds % 60)}` : `${minutes}:${pad(seconds % 60)}`;
}

export function countdown(toIso: string | null, now: number) {
  if (!toIso || !now) return { label: "—", overdue: false, seconds: 0 };
  const seconds = Math.round((Date.parse(toIso) - now) / 1000);
  const absolute = Math.abs(seconds);
  const label = absolute >= 3600 ? `${Math.floor(absolute / 3600)}h ${Math.floor((absolute % 3600) / 60)}m` : `${Math.floor(absolute / 60)}:${String(absolute % 60).padStart(2, "0")}`;
  return { label: seconds < 0 ? `-${label}` : label, overdue: seconds < 0, seconds };
}

export const severityLabel: Record<Severity, string> = { 1: "P1 Emergency", 2: "P2 Urgent", 3: "P3", 4: "P4" };
export const channelLabel: Record<HandlingChannel, string> = { voice: "Call", chat: "Chat", sms: "Text", callback: "Callback" };
export const languageLabel = (code: string) => ({ en: "English", es: "Spanish" } as Record<string, string>)[code] || code.toUpperCase();
export const humanize = (value: string) => value.replaceAll("_", " ");

export function formatClock(iso: string | null) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function formatNumber(e164: string | null) {
  if (!e164) return "";
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : e164;
}

// Distinct audio cue per severity (DSK-025); silent if audio is unavailable.
export function playOfferCue(severity: Severity) {
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const tones = severity <= 1 ? [988, 740, 988, 740] : severity === 2 ? [880, 660] : [660];
    tones.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, context.currentTime + index * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + index * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + index * 0.18 + 0.16);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(context.currentTime + index * 0.18);
      oscillator.stop(context.currentTime + index * 0.18 + 0.17);
    });
    setTimeout(() => void context.close().catch(() => undefined), tones.length * 200 + 200);
  } catch {
    // Browsers may block audio until the first user gesture.
  }
}
