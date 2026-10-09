import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { isValidSlug } from "./site-store";

// Per-business booking integration (Google Calendar + Gmail), keyed by the generated
// site's business slug. OAuth tokens are encrypted at rest (AES-256-GCM, as on main).
export type GoogleConnection = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string[];
  tokenType: string;
  connectedAt: string;
};
export const bookingSettingsSchema = z.object({
  timeZone: z
    .string()
    .trim()
    .max(100)
    .refine(
      (zone) => !zone || validTimeZone(zone),
      "Choose a valid time zone.",
    ),
  durationMinutes: z.number().int().min(5).max(480),
  notifyEmail: z
    .string()
    .trim()
    .max(254)
    .refine(
      (email) => !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
      "Enter a valid notification email.",
    ),
});
export type BookingSettings = z.infer<typeof bookingSettingsSchema>;
export type BookingRecord = {
  id: string;
  kind: "appointment" | "callback" | "handoff";
  createdAt: string;
  callerName: string;
  callerPhone: string;
  service?: string;
  date?: string;
  time?: string;
  timeZone?: string;
  reason?: string;
  urgency?: string;
  status: "confirmed" | "saved";
  googleEventId?: string;
  googleEventUrl?: string;
  email: "sent" | "not_configured" | "failed";
};
type EncryptedPayload = {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
};
type IntegrationRecord = {
  version: 1;
  slug: string;
  settings: BookingSettings;
  google?: EncryptedPayload;
  activity: BookingRecord[];
};

export function validTimeZone(zone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
function credentialSecret() {
  const secret = (process.env.CREDENTIAL_ENCRYPTION_KEY ?? "").trim();
  if (secret.length < 32)
    throw new Error(
      "CREDENTIAL_ENCRYPTION_KEY must contain at least 32 characters.",
    );
  return createHash("sha256").update(secret).digest();
}
export function encryptPayload<T>(value: T): EncryptedPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", credentialSecret(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return {
    version: 1,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
}
export function decryptPayload<T>(payload: EncryptedPayload): T {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    credentialSecret(),
    Buffer.from(payload.iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(payload.tag, "base64url"));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8"),
  ) as T;
}

const defaultSettings: BookingSettings = {
  timeZone: "",
  durationMinutes: 60,
  notifyEmail: "",
};
function filePath(slug: string) {
  if (!isValidSlug(slug)) throw new Error("Invalid business.");
  const root = path.resolve(
    /* turbopackIgnore: true */
    process.env.INTEGRATIONS_DIR ||
      path.join(process.cwd(), "data", "integrations"),
  );
  const file = path.resolve(root, `${slug}.json`);
  if (!file.startsWith(root + path.sep)) throw new Error("Invalid business.");
  return file;
}
async function read(slug: string): Promise<IntegrationRecord> {
  try {
    const record = JSON.parse(await readFile(filePath(slug), "utf8"));
    if (record.version !== 1 || record.slug !== slug)
      throw new Error("Invalid integration record.");
    return {
      ...record,
      settings: { ...defaultSettings, ...record.settings },
      activity: Array.isArray(record.activity) ? record.activity : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { version: 1, slug, settings: defaultSettings, activity: [] };
    throw error;
  }
}
const locks = new Map<string, Promise<unknown>>();
async function write(slug: string, next: IntegrationRecord) {
  const file = filePath(slug);
  const temporary = `${file}.${randomUUID()}.tmp`;
  await mkdir(path.dirname(file), { recursive: true });
  try {
    await writeFile(temporary, JSON.stringify(next), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
/**
 * Serializes read-modify-write per business in this process. Bookings run their
 * availability check and event creation inside this, so one slot cannot be booked twice.
 */
export async function withIntegration<T>(
  slug: string,
  task: (
    record: IntegrationRecord,
    save: (next: IntegrationRecord) => Promise<void>,
  ) => Promise<T>,
) {
  const file = filePath(slug);
  const previous = locks.get(file) ?? Promise.resolve();
  const run = previous
    .catch(() => undefined)
    .then(async () => task(await read(slug), (next) => write(slug, next)));
  locks.set(file, run);
  try {
    return await run;
  } finally {
    if (locks.get(file) === run) locks.delete(file);
  }
}
export async function readIntegration(slug: string) {
  return read(slug);
}
export type { IntegrationRecord };
