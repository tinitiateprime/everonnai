export function assistantConnectionError(
  cause: unknown,
  mode: "chat" | "voice",
) {
  const name =
    cause && typeof cause === "object" && "name" in cause
      ? String(cause.name)
      : "";
  const message =
    typeof cause === "string"
      ? cause
      : cause && typeof cause === "object" && "message" in cause
        ? String(cause.message)
        : "The assistant is temporarily unavailable.";
  if (mode === "voice") {
    if (name === "NotAllowedError")
      return "Microphone access was denied. Allow microphone permission in your browser and try again.";
    if (name === "NotFoundError")
      return "No microphone was found. Connect one and try again.";
    if (name === "NotReadableError")
      return "The microphone is unavailable or being used by another app.";
    if (name === "NotSupportedError" || /^not supported\.?$/i.test(message))
      return "Voice is unavailable in this browser or device. Use chat or try another microphone/browser.";
  }
  return message;
}
