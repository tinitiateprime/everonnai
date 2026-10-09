"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { siteSummary } from "@/features/waas/service";
import type { WebsiteGenerationResult } from "@/features/website-studio/progress";
type Site = ReturnType<typeof siteSummary>;
const base = "/api/waas/v1/sites";
async function request<T>(url: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { method, cache: "no-store", ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), signal });
  let data;
  try { data = await response.json(); } catch { throw new Error("Connection interrupted. Resume the saved build to continue."); }
  if (!response.ok) throw new Error(data.error || "Unable to complete the request.");
  return data as T;
}
export function Studio() {
  const [authenticated, setAuthenticated] = useState(false), [loading, setLoading] = useState(true);
  const [sites, setSites] = useState<Site[]>([]), [selected, setSelected] = useState<Site | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [progress, setProgress] = useState("");
  const [generating, setGenerating] = useState(false);
  const [concept, setConcept] = useState<"editorial" | "momentum" | "aura">("editorial");
  const controller = useRef<AbortController | null>(null);
  const form = useRef<HTMLFormElement>(null);
  async function load() { const data = await request<{ sites: Site[] }>(base); setSites(data.sites); return data.sites; }
  useEffect(() => {
    request("/api/studio/session").then(() => { setAuthenticated(true); return load(); }).catch(() => undefined).finally(() => setLoading(false));
    return () => controller.current?.abort();
  }, []);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const element = event.currentTarget;
    try { await request("/api/studio/session", "POST", { apiKey: new FormData(element).get("apiKey") }); element.reset(); setAuthenticated(true); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Sign in failed."); }
    finally { setBusy(false); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const values = new FormData(event.currentTarget);
    const fields = ["businessName", "businessType", "description", "email", "phone", "location", "serviceArea", "hours", "timeZone", "skillId"];
    const profile: Record<string, unknown> = Object.fromEntries(fields.map((key) => [key, values.get(key)]));
    profile.services = String(values.get("services")).split("\n").filter((line) => line.trim()).map((line) => {
      const [name, ...description] = line.split("|");
      return { id: selected?.profile.services.find((item) => item.name === name.trim())?.id, name: name.trim(), description: description.join("|").trim(), active: true };
    });
    profile.verified = values.get("verified") === "on";
    const actions = Object.fromEntries(["booking", "chat", "voice"].map((key) => [key, values.get(key) || ""]));
    try {
      const data = await request<Site>(selected ? base + "/" + selected.id : base, selected ? "PATCH" : "POST", {
        profile, actions, preferences: { ...selected?.preferences, brief: values.get("brief") },
        ...(selected ? { expectedRevision: selected.revision, expectedPreferencesRevision: selected.preferencesRevision } : {}),
      });
      setSelected(data); setProgress("Business details saved."); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Save failed."); }
    finally { setBusy(false); }
  }
  async function generate(resume = false) {
    if (!selected) return;
    const id = selected.id;
    setBusy(true); setGenerating(true); setError(""); setProgress("Starting website build.");
    const abort = new AbortController(); controller.current = abort;
    try {
      let result = resume ? await request<WebsiteGenerationResult>(base + "/" + id + "/build", "GET", undefined, abort.signal) : await request<WebsiteGenerationResult>(base + "/" + id + "/build", "POST", { operation: "start" }, abort.signal);
      if (resume && result.job?.status === "failed") result = await request(base + "/" + id + "/build", "POST", { operation: "resume", jobId: result.job.id }, abort.signal);
      for (let step = 0; step < 1500 && !result.project; step++) {
        if (!result.job) throw new Error("Start a new website build.");
        if (result.job.status === "failed") throw new Error(result.job.error || "Generation failed. Resume to retry this step.");
        if (result.job.status !== "running") throw new Error("The completed draft changed. Refresh the website.");
        setProgress(result.job.progress.message);
        await new Promise((resolve) => setTimeout(resolve, Math.min(result.job!.retryAfterMs || 100, 1000)));
        abort.signal.throwIfAborted();
        result = await request(base + "/" + id + "/build", "POST", { operation: "advance", jobId: result.job.id }, abort.signal);
      }
      if (!result.project) throw new Error("Build paused. Resume to continue.");
      setProgress("Your private draft is ready. Review each design before publishing.");
    } catch (cause) { if (abort.signal.aborted) setProgress("Build paused. Resume to continue."); else setError(cause instanceof Error ? cause.message : "Build interrupted. Resume to continue."); }
    finally {
      controller.current = null;
      setGenerating(false);
      try { const data = await request<Site>(base + "/" + id); setSelected(data); await load(); } catch { /* The saved build can be loaded after reconnecting. */ }
      setBusy(false);
    }
  }
  async function publish() {
    if (!selected?.draft) return;
    setBusy(true); setError("");
    try {
      setSelected(await request(base + "/" + selected.id + "/publish", "POST", { concept, approved: true, draftId: selected.draft.id, expectedLiveReleaseId: selected.liveReleaseId }));
      setProgress("Your website is published."); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Publishing failed."); }
    finally { setBusy(false); }
  }
  async function rollback(releaseId: string) {
    if (!selected) return;
    setBusy(true); setError("");
    try { setSelected(await request(base + "/" + selected.id + "/rollback", "POST", { releaseId, expectedLiveReleaseId: selected.liveReleaseId })); setProgress("Previous release restored."); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Restore failed."); }
    finally { setBusy(false); }
  }
  if (loading) return <main className="shell">Loading Website Studio…</main>;
  if (!authenticated) return <main className="shell"><section className="card login"><span className="eyebrow">EverOnn</span><h1>Website Studio</h1><p>Create a website from your business details, review three designs and publish when ready.</p><form onSubmit={login}><label>Studio access key<input name="apiKey" type="password" required autoComplete="current-password" /></label><button disabled={busy}>Sign in</button></form>{error && <p className="notice error" role="alert">{error}</p>}</section></main>;
  return <main className="shell">
    <header className="masthead"><div><span className="eyebrow">EverOnn</span><h1>Website Studio</h1><span className="muted">Your business. Three original designs. One website.</span></div><button className="secondary" disabled={busy} onClick={async () => { await request("/api/studio/session", "DELETE"); setAuthenticated(false); setSelected(null); setSites([]); }}>Sign out</button></header>
    {error && <p className="notice error" role="alert">{error}</p>}
    {progress && <p className="notice" role="status">{progress}</p>}
    <div className="layout"><aside className="card sidebar"><button disabled={busy} onClick={() => { setSelected(null); setError(""); setProgress(""); form.current?.reset(); }}>+ New website</button>{sites.map((site) => <button className={selected?.id === site.id ? "active" : "secondary"} disabled={busy} key={site.id} onClick={async () => { try { setSelected(await request(base + "/" + site.id)); setError(""); setProgress(""); } catch (cause) { setError(String(cause)); } }}>{site.profile.businessName}</button>)}</aside>
    <section className="card"><h2>{selected ? selected.profile.businessName : "Create your website"}</h2>
      <form key={selected?.id || "new"} ref={form} onSubmit={save}><div className="fields">
        <label>Business name<input name="businessName" defaultValue={selected?.profile.businessName} required maxLength={120} /></label>
        <label>Business type<input name="businessType" defaultValue={selected?.profile.businessType} placeholder="e.g. Carpentry" required maxLength={120} /></label>
        <label className="span">Business description<textarea name="description" defaultValue={selected?.profile.description} required minLength={40} maxLength={2400} rows={3} /></label>
        <label>Email<input name="email" type="email" defaultValue={selected?.profile.email} /></label><label>Phone<input name="phone" type="tel" defaultValue={selected?.profile.phone} /></label>
        <label>Location<input name="location" defaultValue={selected?.profile.location} /></label><label>Service area<input name="serviceArea" defaultValue={selected?.profile.serviceArea} /></label>
        <label>Business hours<input name="hours" defaultValue={selected?.profile.hours} /></label><label>Time zone<input name="timeZone" defaultValue={selected?.profile.timeZone || "UTC"} required placeholder="Asia/Kolkata" /></label>
        <label>Industry guidance<select name="skillId" defaultValue={selected?.profile.skillId || "general"}><option value="general">General business</option><option value="hvac">Heating and cooling</option></select></label>
        <label className="span">Services — one per line: Name | Description<textarea name="services" defaultValue={selected?.profile.services.map((service) => service.name + " | " + service.description).join("\n")} rows={4} required /></label>
        <label className="span">Design brief<textarea name="brief" defaultValue={selected?.preferences.brief} placeholder="Describe the look, tone and priorities you want." maxLength={3000} rows={3} /></label>
        <label>Booking or contact URL<input name="booking" type="url" defaultValue={selected?.actions.booking} placeholder="https://your-site.com/contact" /></label>
        <label>Chat URL (optional)<input name="chat" type="url" defaultValue={selected?.actions.chat} /></label>
        <label>Voice or call URL (optional)<input name="voice" type="url" defaultValue={selected?.actions.voice} /></label>
        <label className="check span"><input name="verified" type="checkbox" defaultChecked={selected?.profile.verified} />The business owner has verified these facts.</label>
      </div><button disabled={busy}>Save business details</button></form>
      {selected && <><div className="actions"><button disabled={busy} onClick={() => generate(false)}>Generate new draft</button>{selected.job && selected.job.status !== "completed" && <button className="secondary" disabled={busy} onClick={() => generate(true)}>Resume saved build</button>}{generating && <button className="secondary" onClick={() => controller.current?.abort()}>Pause build</button>}</div><p className="muted">Save changes before generating. Generation uses your configured AI account. Booking and assistant links open your own services; missing links use the business contact details.</p></>}
      {selected?.previewUrl && <><h3>Review your draft</h3><div className="actions"><select aria-label="Design" value={concept} onChange={(event) => setConcept(event.target.value as typeof concept)}>{selected.draft?.concepts.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select><a href={selected.previewUrl + "?theme=" + concept} target="_blank" rel="noreferrer">Open full preview</a></div><iframe className="preview" title="Website draft preview" src={selected.previewUrl + "?theme=" + concept} sandbox="allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation" /><div className="actions"><button disabled={busy || !selected.draft?.qa.passed || selected.draft.status === "published"} onClick={publish}>Approve &amp; publish this design</button></div>{selected.draft?.qa.checks.filter((check) => !check.passed).map((check) => <p className="notice error" key={check.key}>{check.message}</p>)}</>}
      {selected?.publicUrl && <><h3>Published website</h3><p><a href={selected.publicUrl} target="_blank" rel="noreferrer">Open live website</a></p><p className="muted">Add this URL to your website as a link or iframe. Export the HTML pages with the included export example.</p>{selected.releases.map((release) => <div className="release" key={release.id}><span>{new Date(release.publishedAt).toLocaleString()} · {release.concept}</span><button className="secondary" disabled={busy} onClick={() => rollback(release.id)}>Restore release</button></div>)}</>}
    </section></div>
  </main>;
}
