"use client";

import type { DeskCommandType, DeskSnapshot } from "@/features/call-center/types";

export class DeskApiError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
  }
}

async function parse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({})) as T & { error?: string; code?: string };
  if (!response.ok) throw new DeskApiError(data.error || "The desk request failed.", data.code || "unavailable", response.status);
  return data;
}

export async function fetchDeskJson<T>(url: string) {
  return parse<T>(await fetch(url, { cache: "no-store" }));
}

export async function fetchSnapshot(session: string) {
  return fetchDeskJson<DeskSnapshot>(`/api/call-center/snapshot?session=${encodeURIComponent(session)}`);
}

// Every command carries a fresh idempotency id (Appendix J); the response
// includes the authoritative snapshot after the change.
export async function sendDeskCommand(session: string, type: DeskCommandType, payload: Record<string, unknown> = {}) {
  const response = await fetch("/api/call-center/commands", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-desk-session": session },
    body: JSON.stringify({ type, id: crypto.randomUUID(), payload }),
  });
  return parse<{ ok: true; result: Record<string, unknown>; snapshot: DeskSnapshot }>(response);
}
