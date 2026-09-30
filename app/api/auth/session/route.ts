import { NextResponse } from "next/server";
import { getCurrentActor } from "@/features/auth/session";
import { getAuthSetupState } from "@/lib/auth-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const [actor, setup] = await Promise.all([getCurrentActor(), getAuthSetupState()]);
  return NextResponse.json({ authenticated: Boolean(actor), actor, ...setup }, { headers: { "Cache-Control": "private, no-store" } });
}
