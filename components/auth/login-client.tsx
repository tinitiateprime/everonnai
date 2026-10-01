"use client";

import { ArrowLeft, Building2, KeyRound, LockKeyhole, Mail, ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type SetupState = { setupRequired: boolean; setupAllowed: boolean; setupTokenRequired: boolean };
type AuthMode = "login" | "register";

export function LoginClient({ setup, returnTo }: { setup: SetupState; returnTo: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("login");
  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const firstRun = setup.setupRequired;
  const creating = firstRun || mode === "register";

  function switchMode(next: AuthMode) {
    setMode(next);
    setPassword("");
    setConfirmPassword("");
    setError("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (creating && password !== confirmPassword) return setError("The passwords do not match.");
    setBusy(true);
    try {
      const endpoint = firstRun ? "/api/auth/setup" : mode === "register" ? "/api/auth/register" : "/api/auth/login";
      const body = firstRun
        ? { name, email, password, setupToken }
        : mode === "register"
          ? { name, businessName, businessType, email, password, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }
          : { email, password };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Unable to continue.");
      router.replace(returnTo);
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to continue.");
    } finally {
      setBusy(false);
    }
  }

  const title = firstRun ? "Create the platform owner." : mode === "register" ? "Create your workspace." : "Welcome back.";
  const copy = firstRun
    ? "Secure the first EverOnn workspace before opening customer registration."
    : mode === "register"
      ? "Start a separate private workspace for your business."
      : "Sign in with your workspace account.";

  return <main className="auth-page"><div className="auth-glow" /><section className="auth-card"><Link href="/" className="auth-brand"><span>∞</span><strong>EverOnn<em>.Ai</em></strong></Link><div className="auth-icon">{creating ? <UserRound /> : <LockKeyhole />}</div><h1>{title}</h1><p>{copy}</p>{firstRun && !setup.setupAllowed ? <div className="auth-setup-block"><ShieldCheck /><div><strong>Production setup is locked</strong><p>Add EVERONN_AUTH_SETUP_TOKEN to the server environment, restart, and use that token here.</p></div></div> : <form onSubmit={submit}>{creating && <label><span>Your name</span><div><UserRound /><input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required /></div></label>}{mode === "register" && !firstRun && <><label><span>Business name</span><div><Building2 /><input value={businessName} onChange={(event) => setBusinessName(event.target.value)} autoComplete="organization" required /></div></label><label><span>Business type</span><div><Building2 /><input value={businessType} onChange={(event) => setBusinessType(event.target.value)} placeholder="Example: HVAC service company" required /></div></label></>}<label><span>Work email</span><div><Mail /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></div></label><label><span>Password</span><div><KeyRound /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={creating ? "new-password" : "current-password"} minLength={12} required /></div></label>{creating && <><label><span>Confirm password</span><div><KeyRound /><input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={12} required /></div></label>{firstRun && setup.setupTokenRequired && <label><span>Owner setup token</span><div><ShieldCheck /><input type="password" value={setupToken} onChange={(event) => setSetupToken(event.target.value)} autoComplete="off" required /></div></label>}<small className="auth-password-help">Use 12+ characters with uppercase, lowercase, a number, and a symbol.</small></>}{error && <small className="auth-error" role="alert">{error}</small>}<button disabled={busy}>{busy ? "Please wait…" : firstRun ? "Create platform owner" : mode === "register" ? "Create account and workspace" : "Sign in securely"}</button>{!firstRun && mode === "login" && <><button type="button" className="auth-text-button" onClick={() => switchMode("register")}><UserRound /> Create a new account</button><small className="auth-password-help">Joining an existing team? Ask its owner for a secure invitation link. Password recovery is not enabled yet.</small></>}{!firstRun && mode === "register" && <button type="button" className="auth-text-button" onClick={() => switchMode("login")}><ArrowLeft /> Back to sign in</button>}</form>}<footer><ShieldCheck /> Private workspace · Hashed passwords · Role-protected access</footer></section><aside className="auth-story"><span>Secure workspace isolation</span><h2>Every business and every role sees only what belongs to them.</h2><div><i /><p>New customers receive a separate workspace with no shared leads, contacts, or settings.</p></div><div><i /><p>Owners invite managers, agents, and viewers into that business only.</p></div><div><i /><p>Server-side permissions protect every private action after sign-in.</p></div></aside></main>;
}
