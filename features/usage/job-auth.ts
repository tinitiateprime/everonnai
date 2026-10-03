import { createHash, timingSafeEqual } from "node:crypto";

export function authorizedUsageJob(request: Request) {
  const secret = process.env.USAGE_CRON_SECRET || "";
  if (secret.length < 32) return false;
  const received = request.headers.get("authorization") || "";
  return timingSafeEqual(createHash("sha256").update(received).digest(), createHash("sha256").update(`Bearer ${secret}`).digest());
}
