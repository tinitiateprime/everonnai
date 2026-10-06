"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";
export function ConnectRepositoryDialog({ onClose, onConnect }: { onClose: () => void; onConnect: (input: { url: string; branch: string; folder: string; token: string }) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setPending(true); setError("");
    try { await onConnect({ url: String(fields.get("url") || ""), branch: String(fields.get("branch") || ""), folder: String(fields.get("folder") || ""), token: String(fields.get("token") || "") }); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The repository could not be connected."); setPending(false); }
  }
  return <dialog ref={dialog} className="pw-connect-dialog" aria-labelledby="connect-repository-title" onCancel={(event) => { event.preventDefault(); if (!pending) onClose(); }}>
    <header><div><h2 id="connect-repository-title">Connect a GitHub repository</h2><p>Share its project documentation with your workspace team.</p></div><button type="button" onClick={onClose} disabled={pending} aria-label="Close repository connection"><X size={18} /></button></header>
    <form onSubmit={submit}><label>Repository URL<input name="url" type="url" required autoFocus placeholder="https://github.com/company/project" maxLength={300} /></label><div className="pw-form-columns"><label>Branch (optional)<input name="branch" placeholder="Default branch" maxLength={160} /></label><label>Documentation folder (optional)<input name="folder" placeholder="docs" maxLength={300} /></label></div><label>GitHub token (optional)<input name="token" type="password" autoComplete="off" maxLength={500} placeholder="Required for a private repository" /></label><p className="pw-form-hint">For private repositories, use a fine-grained token with Contents read permission for this repository. Tokens are encrypted on the server.</p>{error && <p role="alert" className="pw-error">{error}</p>}<footer><button type="button" onClick={onClose} disabled={pending}>Cancel</button><button type="submit" disabled={pending}>{pending ? "Connecting..." : "Connect repository"}</button></footer></form>
  </dialog>;
}
