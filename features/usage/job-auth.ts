import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const usageJobNoncePattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const signatureMessage = (timestamp: string, nonce: string) => `usage-job-v1\nPOST\n/api/usage/jobs\n${timestamp}\n${nonce}`;

export function usageJobSignedHeaders(secret: string, now = Date.now(), nonce = randomUUID()) {
  if (secret.length < 32 || !usageJobNoncePattern.test(nonce)) throw new Error("Invalid usage job signing configuration.");
  const timestamp = String(Math.floor(now / 1000));
  return {
    "Content-Type": "application/json",
    "x-everonn-usage-timestamp": timestamp,
    "x-everonn-usage-nonce": nonce,
    "x-everonn-usage-signature": createHmac("sha256", secret).update(signatureMessage(timestamp, nonce)).digest("hex"),
  };
}

export function signedUsageJobNonce(request: Request, now = Date.now()) {
  const secret = process.env.USAGE_CRON_SECRET || "";
  const timestamp = request.headers.get("x-everonn-usage-timestamp") || "";
  const nonce = request.headers.get("x-everonn-usage-nonce") || "";
  const signature = request.headers.get("x-everonn-usage-signature") || "";
  if (secret.length < 32 || request.method !== "POST" || new URL(request.url).pathname !== "/api/usage/jobs"
    || !/^\d{1,12}$/.test(timestamp) || !usageJobNoncePattern.test(nonce) || !/^[a-f0-9]{64}$/.test(signature)) return null;
  const age = now - Number(timestamp) * 1000;
  if (age > 180_000 || age < -30_000) return null;
  const expected = createHmac("sha256", secret).update(signatureMessage(timestamp, nonce)).digest();
  return timingSafeEqual(Buffer.from(signature, "hex"), expected) ? nonce : null;
}

export function authorizedUsageJob(request: Request) {
  const secret = process.env.USAGE_CRON_SECRET || "";
  if (secret.length < 32) return false;
  const received = request.headers.get("authorization") || "";
  return timingSafeEqual(createHash("sha256").update(received).digest(), createHash("sha256").update(`Bearer ${secret}`).digest());
}
