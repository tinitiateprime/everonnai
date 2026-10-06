import type { WebsiteSpec } from "@/features/everonn/types";
import type { WebsitePreferences } from "@/features/agent-runtime/types";

export function readableInk(color: string) {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return "#ffffff";
  const channels = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16) / 255).map((channel) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
  const luminance = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  return (luminance + .05) / .05 > 1.05 / (luminance + .05) ? "#111111" : "#ffffff";
}

export function applyWebsitePreferences(spec: WebsiteSpec, preferences?: WebsitePreferences) {
  if (preferences?.primaryColor) spec.visualDirection.primaryColor = preferences.primaryColor;
  if (preferences?.accentColor) spec.visualDirection.accentColor = preferences.accentColor;
  if (preferences?.imagery === "none") spec.media = { hero: null, story: null, gallery: [], services: {} };
  return spec;
}
