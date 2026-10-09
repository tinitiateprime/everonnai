import { randomBytes } from "node:crypto";

// UUIDv7 stored as BINARY(16) and exposed as prefixed Crockford base32
// strings (spec §21.2): time-ordered for index locality, never sequential.
const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const decodeMap = new Map([...alphabet].map((char, index) => [char, index]));

export const idPrefixes = {
  tenant: "tnt", line: "lin", phoneNumber: "num", contact: "ctc", conversation: "cnv", message: "msg", request: "req",
  escalation: "esc", escalationEvent: "eev", offer: "ofr", handling: "hdl", handlingEvent: "hev", approval: "apr",
  task: "tsk", wrongClient: "wci", unresolvedLine: "uli", qaReview: "qar", operator: "opr", operatorOrg: "org",
  greeting: "grt", transferContact: "xfr", usageEvent: "use", outboxEvent: "evt", shift: "shf",
} as const;

export type IdPrefix = (typeof idPrefixes)[keyof typeof idPrefixes];

export function uuidv7(now = Date.now()) {
  const bytes = randomBytes(16);
  const ms = BigInt(now);
  for (let index = 0; index < 6; index += 1) bytes[index] = Number((ms >> BigInt(8 * (5 - index))) & BigInt(0xff));
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return bytes;
}

function encode(bytes: Buffer) {
  let value = BigInt(`0x${bytes.toString("hex")}`);
  let output = "";
  for (let index = 0; index < 26; index += 1) {
    output = alphabet[Number(value & BigInt(31))] + output;
    value >>= BigInt(5);
  }
  return output;
}

export function toExternalId(prefix: IdPrefix, bytes: Buffer | Uint8Array | null | undefined) {
  if (!bytes) return null;
  return `${prefix}_${encode(Buffer.from(bytes))}`;
}

export class InvalidIdError extends Error {
  readonly status = 400;
  readonly code = "invalid_id";
}

export function toBinaryId(prefix: IdPrefix, external: unknown) {
  if (typeof external !== "string" || !external.startsWith(`${prefix}_`)) throw new InvalidIdError(`Expected a ${prefix}_ identifier.`);
  const body = external.slice(prefix.length + 1).toUpperCase();
  if (body.length !== 26 || body.charCodeAt(0) > 55) throw new InvalidIdError(`Malformed ${prefix}_ identifier.`);
  let value = BigInt(0);
  for (const char of body) {
    const digit = decodeMap.get(char);
    if (digit === undefined) throw new InvalidIdError(`Malformed ${prefix}_ identifier.`);
    value = (value << BigInt(5)) | BigInt(digit);
  }
  return Buffer.from(value.toString(16).padStart(32, "0"), "hex");
}

export function newId(prefix: IdPrefix, now = Date.now()) {
  const bytes = uuidv7(now);
  return { bytes, id: toExternalId(prefix, bytes) as string };
}
