import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const keyLength = 64;

function derive(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, keyLength, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key as Buffer);
    });
  });
}
export function passwordIssues(password: string) {
  const issues: string[] = [];
  if (password.length < 12) issues.push("Use at least 12 characters.");
  if (password.length > 128) issues.push("Use no more than 128 characters.");
  if (!/[a-z]/.test(password)) issues.push("Add a lowercase letter.");
  if (!/[A-Z]/.test(password)) issues.push("Add an uppercase letter.");
  if (!/\d/.test(password)) issues.push("Add a number.");
  if (!/[^A-Za-z0-9]/.test(password)) issues.push("Add a symbol.");
  return issues;
}

export async function hashPassword(password: string) {
  const issues = passwordIssues(password);
  if (issues.length) throw new Error(issues.join(" "));
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, saltValue, keyValue] = encoded.split("$");
  if (algorithm !== "scrypt" || !saltValue || !keyValue) return false;
  try {
    const expected = Buffer.from(keyValue, "base64url");
    const supplied = await derive(password, Buffer.from(saltValue, "base64url"));
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  } catch {
    return false;
  }
}
