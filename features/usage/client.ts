// Best-effort notification only. The server independently discovers sessions
// from ElevenLabs if a browser disappears, and obtains all metrics itself.
export async function notifyElevenLabsUsage(sessionId: string | undefined, conversationId: string | undefined) {
  if (!sessionId || !conversationId) return;
  await fetch("/api/usage/elevenlabs/session", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, conversationId }), keepalive: true,
  }).catch(() => undefined);
}
