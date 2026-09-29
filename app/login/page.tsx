"use client";

import { ArrowLeft, CheckCircle2, KeyRound, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import "./login.css";

type Mode = "login" | "mfa" | "reset" | "reset-sent";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("owner@northstar.example");
  const [password, setPassword] = useState("everonn-demo");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (mode === "login") {
      if (!email.includes("@") || password.length < 8) return setError("Enter a valid email and a password of at least eight characters.");
      setMode("mfa");
      return;
    }
    if (mode === "mfa") {
      if (!/^\d{6}$/.test(code)) return setError("Enter the six-digit verification code.");
      window.localStorage.setItem("everonn:demo-session", JSON.stringify({ email, mfaVerifiedAt: new Date().toISOString() }));
      router.push("/dashboard");
      return;
    }
    if (mode === "reset") setMode("reset-sent");
  }

  return <main className="auth-page"><div className="auth-glow" /><section className="auth-card"><Link href="/" className="auth-brand"><span>∞</span><strong>EverOnn<em>.Ai</em></strong></Link>{mode === "login" && <><div className="auth-icon"><LockKeyhole /></div><h1>Welcome back.</h1><p>Sign in to manage your customer front.</p><form onSubmit={submit}><label><span>Work email</span><div><Mail /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></div></label><label><span>Password</span><div><KeyRound /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></div></label>{error && <small className="auth-error">{error}</small>}<button>Continue securely</button><button type="button" className="auth-text-button" onClick={() => setMode("reset")}>Forgot your password?</button></form></>}{mode === "mfa" && <><div className="auth-icon"><ShieldCheck /></div><h1>Verify it’s you.</h1><p>Enter the six-digit code from your authenticator. For this local demo, any six digits continue.</p><form onSubmit={submit}><label><span>Verification code</span><input className="auth-code" inputMode="numeric" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} placeholder="000000" autoFocus /></label>{error && <small className="auth-error">{error}</small>}<button>Verify and open workspace</button><button type="button" className="auth-text-button" onClick={() => setMode("login")}><ArrowLeft /> Back to sign in</button></form></>}{mode === "reset" && <><div className="auth-icon"><Mail /></div><h1>Reset your password.</h1><p>We’ll send a short-lived reset link if the account exists.</p><form onSubmit={submit}><label><span>Work email</span><div><Mail /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></div></label><button>Send reset link</button><button type="button" className="auth-text-button" onClick={() => setMode("login")}><ArrowLeft /> Back to sign in</button></form></>}{mode === "reset-sent" && <><div className="auth-icon success"><CheckCircle2 /></div><h1>Check your email.</h1><p>If an EverOnn account exists for {email}, a password reset link has been prepared.</p><button className="auth-main-button" onClick={() => setMode("login")}>Return to sign in</button></>}<footer><ShieldCheck /> Workspace-scoped access · MFA-ready · Session protected</footer></section><aside className="auth-story"><span>One business brain</span><h2>Website, calls, chat, and customer follow-up—working together.</h2><div><i /><p>Business facts are entered once and approved before AI channels can use them.</p></div><div><i /><p>Workspace roles separate owners, managers, agents, and viewers.</p></div><div><i /><p>Private website previews remain protected until owner verification and approval.</p></div></aside></main>;
}
