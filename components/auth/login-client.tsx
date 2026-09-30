"use client";

import { KeyRound, LockKeyhole, Mail, ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type SetupState = { setupRequired: boolean; setupAllowed: boolean; setupTokenRequired: boolean };

export function LoginClient({ setup, returnTo }: { setup: SetupState; returnTo: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const firstRun = setup.setupRequired;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (firstRun && password !== confirmPassword) return setError("The passwords do not match.");
    setBusy(true);
    try {
      const response = await fetch(firstRun ? "/api/auth/setup" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(firstRun ? { name, email, password, setupToken } : { email, password }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Unable to sign in.");
      router.replace(returnTo);
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to sign in.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth-page"><div className="auth-glow" /><section className="auth-card"><Link href="/" className="auth-brand"><span>∞</span><strong>EverOnn<em>.Ai</em></strong></Link><div className="auth-icon">{firstRun ? <UserRound /> : <LockKeyhole />}</div><h1>{firstRun ? "Create the owner account." : "Welcome back."}</h1><p>{firstRun ? "Secure this workspace before inviting the rest of the team." : "Sign in with your workspace account."}</p>{firstRun && !setup.setupAllowed ? <div className="auth-setup-block"><ShieldCheck /><div><strong>Production setup is locked</strong><p>Add EVERONN_AUTH_SETUP_TOKEN to the server environment, restart, and use that token here.</p></div></div> : <form onSubmit={submit}>{firstRun && <label><span>Owner name</span><div><UserRound /><input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required /></div></label>}<label><span>Work email</span><div><Mail /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></div></label><label><span>Password</span><div><KeyRound /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={firstRun ? "new-password" : "current-password"} minLength={12} required /></div></label>{firstRun && <><label><span>Confirm password</span><div><KeyRound /><input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={12} required /></div></label>{setup.setupTokenRequired && <label><span>Owner setup token</span><div><ShieldCheck /><input type="password" value={setupToken} onChange={(event) => setSetupToken(event.target.value)} autoComplete="off" required /></div></label>}<small className="auth-password-help">Use 12+ characters with uppercase, lowercase, a number, and a symbol.</small></>}{error && <small className="auth-error" role="alert">{error}</small>}<button disabled={busy}>{busy ? "Please wait…" : firstRun ? "Create owner and sign in" : "Sign in securely"}</button>{!firstRun && <small className="auth-password-help">Password recovery is not enabled yet. Contact the deployment administrator if you lose access.</small>}</form>}<footer><ShieldCheck /> HttpOnly session · Hashed passwords · Role-protected access</footer></section><aside className="auth-story"><span>One secure workspace</span><h2>Every person sees only what their role allows.</h2><div><i /><p>Owners control team access, billing, integrations, and publishing.</p></div><div><i /><p>Managers configure the business and operate customer workflows.</p></div><div><i /><p>Agents handle customers while viewers receive read-only access.</p></div></aside></main>;
}
