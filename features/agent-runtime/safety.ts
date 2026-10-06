// Safety is checked before scheduling clarification, without relying on a model to apply prompt priority.
export function immediateSafetyReply(message: string) {
  const text = message.replace(/\b(?:no|not|without)\s+(?:a\s+)?(?:gas (?:smell|leak)|smoke|fire|sparks|carbon monoxide)\b/gi, " ");
  if (!/\b(?:smell(?:ing)? (?:of )?gas|gas (?:smell|odor|odour|leak)|carbon[- ]monoxide(?: alarm)?|CO alarm|on fire|smoke|smoking|sparks?|sparking|electric(?:al)? shock)\b/i.test(text)) return null;
  return "This may be an immediate safety risk. Move to a safe location and contact your local emergency service now. Please do not attempt repairs or wait for a service appointment. Once you are safe, the business can arrange human follow-up.";
}

export function preventUnverifiedActionClaim(reply: string) {
  if (/\b(?:your appointment (?:is |has been )?(?:confirmed|booked)|you(?:'re| are) (?:booked|scheduled)|(?:i(?:'ve| have)|we(?:'ve| have)) (?:booked|scheduled|confirmed|sent|transferred))\b/i.test(reply)) {
    return "I can help collect your request. An appointment is confirmed only after the connected calendar succeeds; the request workflow will show that result.";
  }
  return reply;
}
