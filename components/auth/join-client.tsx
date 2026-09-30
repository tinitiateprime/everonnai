"use client";

import { KeyRound, ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import type { WorkspaceRole } from "@/features/everonn/types";

type Invitation = { name: string; email: string; role: Exclude<WorkspaceRole, "owner">; businessName: string; expiresAt: string };

export function JoinClient({ token, invitation }: { token: string; invitation: Invitation | null }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirmPassword) return setError("The passwords do not match.");
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/auth/invitations/${encodeURIComponent(token)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Unable to accept this invitation.");
      router.replace("/dashboard");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to accept this invitation.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth-page"><div className="auth-glow" /><section className="auth-card"><Link href="/" className="auth-brand"><span>∞</span><strong>EverOnn<em>.Ai</em></strong></Link>{!invitation ? <><div className="auth-icon"><ShieldCheck /></div><h1>Invitation unavailable.</h1><p>This invitation is invalid, expired, or has already been accepted.</p><Link className="auth-main-button auth-link-button" href="/login">Go to sign in</Link></> : <><div className="auth-icon"><UserRound /></div><h1>Join {invitation.businessName}.</h1><p>{invitation.name}, your account will have the <strong>{invitation.role}</strong> role. Sign in later with {invitation.email}.</p><form onSubmit={submit}><label><span>Create password</span><div><KeyRound /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={12} required /></div></label><label><span>Confirm password</span><div><KeyRound /><input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={12} required /></div></label><small className="auth-password-help">Use 12+ characters with uppercase, lowercase, a number, and a symbol.</small>{error && <small className="auth-error" role="alert">{error}</small>}<button disabled={busy}>{busy ? "Creating account…" : "Accept invitation"}</button></form></>}<footer><ShieldCheck /> Secure invitation · Role-scoped access</footer></section><aside className="auth-story"><span>EverOnn workspace</span><h2>One team, one approved source of business knowledge.</h2><div><i /><p>Your permissions are controlled by the workspace owner.</p></div><div><i /><p>Passwords are stored only as strong one-way hashes.</p></div><div><i /><p>Your session remains private in an HttpOnly browser cookie.</p></div></aside></main>;
}
