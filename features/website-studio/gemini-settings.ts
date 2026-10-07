// Supported Generate Content settings, scoped to bounded website requests.
// Other model families retain their defaults; 2.5 does not accept thinkingLevel.
export function websiteThinkingConfig(model: string) {
  if (/^gemini-3\.(?:8|7|6|5)-flash$/.test(model)) return { thinkingConfig: { thinkingLevel: "low" } };
  if (/^gemini-3\.(?:5|1)-flash-lite$/.test(model)) return { thinkingConfig: { thinkingLevel: "minimal" } };
  return {};
}
