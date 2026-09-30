import { redirect } from "next/navigation";
import { LoginClient } from "@/components/auth/login-client";
import { getCurrentActor } from "@/features/auth/session";
import { getAuthSetupState } from "@/lib/auth-store";
import "./login.css";

function safeReturnTo(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate?.startsWith("/dashboard") && !candidate.startsWith("//") ? candidate : "/dashboard";
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string | string[] }> }) {
  const actor = await getCurrentActor();
  if (actor) redirect("/dashboard");
  const [setup, query] = await Promise.all([getAuthSetupState(), searchParams]);
  return <LoginClient setup={setup} returnTo={safeReturnTo(query.returnTo)} />;
}
