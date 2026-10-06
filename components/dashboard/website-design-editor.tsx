"use client";

import { useState } from "react";
import { Check, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { useEverOnnWorkspace } from "@/features/everonn/workspace-provider";
import { EMPTY_WEBSITE_PREFERENCES, retrieveWebsiteMemory } from "@/features/agent-runtime/memory";
import type { ScopedMemory, WebsitePreferences, WebsiteSection } from "@/features/agent-runtime/types";

export function WebsiteDesignEditor({ generating, onGenerate }: { generating: boolean; onGenerate: () => Promise<boolean> }) {
  const { workspace, setAgentMemory, syncStatus } = useEverOnnWorkspace();
  const memories = retrieveWebsiteMemory(workspace.aiMemory, workspace.workspaceId);
  const initial = memories.find((item) => item.scope === "project") || memories.find((item) => item.scope === "workspace");
  const [scope, setScope] = useState<"project" | "workspace">("project");
  const remembered = memories.find((item) => item.scope === scope);
  const [preferences, setPreferences] = useState<WebsitePreferences>(() => ({ ...(initial?.value || EMPTY_WEBSITE_PREFERENCES) }));
  const [expectedRevision, setExpectedRevision] = useState<string | null>(() => memories.find((item) => item.scope === "project")?.revision || null);
  const [changeRequest, setChangeRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const field = <K extends keyof WebsitePreferences>(key: K, value: WebsitePreferences[K]) => setPreferences((current) => ({ ...current, [key]: value }));

  function switchScope(value: "project" | "workspace") {
    const record = memories.find((item) => item.scope === value);
    setScope(value); setExpectedRevision(record?.revision || null);
    setPreferences({ ...(record?.value || EMPTY_WEBSITE_PREFERENCES) });
    setNotice(""); setError("");
  }

  async function save(regenerate: boolean) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/agent-runtime/memory", {
        method: "PUT", headers: { "Content-Type": "application/json", "x-everonn-workspace": workspace.workspaceId },
        body: JSON.stringify({ preferences, changeRequest, scope, expectedRevision }),
      });
      const data = await response.json() as { memory?: ScopedMemory[]; error?: string };
      if (!response.ok || !data.memory) throw new Error(data.error || "Your website preferences could not be saved.");
      setAgentMemory(data.memory);
      const saved = data.memory.find((item) => item.scope === scope);
      if (saved) setPreferences(saved.value);
      setExpectedRevision(data.memory.find((item) => item.scope === scope)?.revision || null);
      setChangeRequest("");
      setNotice(regenerate ? "Your changes are saved. Building a new private preview…" : "Preferences saved for the next website generation.");
      if (regenerate) {
        const generated = await onGenerate();
        setNotice(generated ? "Your new private preview is ready to review." : "Your preferences are saved. The previous website is kept; see the generation error below.");
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Your changes could not be applied."); }
    finally { setBusy(false); }
  }

  async function forget() {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/agent-runtime/memory", {
        method: "DELETE", headers: { "Content-Type": "application/json", "x-everonn-workspace": workspace.workspaceId },
        body: JSON.stringify({ scope, expectedRevision }),
      });
      const data = await response.json() as { memory?: ScopedMemory[]; error?: string };
      if (!response.ok || !data.memory) throw new Error(data.error || "The saved choices could not be cleared.");
      setAgentMemory(data.memory); setExpectedRevision(null); setChangeRequest("");
      const inherited = scope === "project" ? data.memory.find((item) => item.scope === "workspace") : undefined;
      setPreferences({ ...(inherited?.value || EMPTY_WEBSITE_PREFERENCES) });
      setNotice("Saved choices cleared for this scope. Your published website is unchanged.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The saved choices could not be cleared."); }
    finally { setBusy(false); }
  }

  return <section className="eo-panel eo-design-editor">
    <div className="eo-panel-heading"><div><span>Your website, your direction</span><h2>Tell us what you want to change.</h2></div><Sparkles /></div>
    <p className="eo-editor-help">Describe the look and experience you want. Your choices stay with your business and carry into future revisions.</p>
    <label className="eo-design-request">Request changes<textarea rows={3} maxLength={3000} value={changeRequest} onChange={(event) => setChangeRequest(event.target.value)} placeholder="Make it premium with black and gold. Put AC repair first, use equipment photos, and make the hero more spacious." /></label>
    <details className="eo-design-options"><summary>Design preferences &amp; remembered choices</summary>
      <div className="eo-form-grid">
        <label>Apply preferences to<select value={scope} onChange={(event) => switchScope(event.target.value as typeof scope)}><option value="project">This website</option><option value="workspace">My business default</option></select></label>
        <label>Priority service<select value={preferences.priorityServiceId} onChange={(event) => field("priorityServiceId", event.target.value)}><option value="">Let the design choose</option>{workspace.profile.services.filter((service) => service.active).map((service) => <option value={service.id} key={service.id}>{service.name}</option>)}</select></label>
        <label className="wide">Overall design direction<textarea rows={2} maxLength={3000} value={preferences.brief} onChange={(event) => field("brief", event.target.value)} placeholder="Describe your brand, audience, and the feeling you want." /></label>
        <label>Primary color<input value={preferences.primaryColor} maxLength={7} onChange={(event) => field("primaryColor", event.target.value)} placeholder="Automatic or #111111" /></label>
        <label>Accent color<input value={preferences.accentColor} maxLength={7} onChange={(event) => field("accentColor", event.target.value)} placeholder="Automatic or #D4AF37" /></label>
        <label>Typography<select aria-label="Typography" value={preferences.typography} onChange={(event) => field("typography", event.target.value as WebsitePreferences["typography"])}><option value="auto">Choose for my brand</option><option value="modern">Clean &amp; modern</option><option value="editorial">Expressive serif</option><option value="technical">Precise &amp; technical</option></select></label>
        <label>Spacing<select value={preferences.density} onChange={(event) => field("density", event.target.value as WebsitePreferences["density"])}><option value="auto">Choose for my content</option><option value="airy">Generous whitespace</option><option value="compact">More compact</option></select></label>
        <label>Photography<select aria-label="Photography" value={preferences.imagery} onChange={(event) => field("imagery", event.target.value as WebsitePreferences["imagery"])}><option value="auto">Choose for my business</option><option value="equipment">Equipment &amp; interiors</option><option value="people">People &amp; service work</option><option value="none">No photography</option></select></label>
        <label>Keep these choices<textarea rows={3} value={preferences.accepted.join("\n")} onChange={(event) => field("accepted", event.target.value.split("\n"))} placeholder="One preference per line" /></label>
        <label>Avoid these choices<textarea rows={3} value={preferences.rejected.join("\n")} onChange={(event) => field("rejected", event.target.value.split("\n"))} placeholder="Blue theme&#10;Technician stock photos" /></label>
        <fieldset className="wide eo-design-sections"><legend>Hide optional homepage sections</legend>{(["benefits", "about", "process", "gallery", "faq"] as WebsiteSection[]).map((id) => <label key={id}><input type="checkbox" checked={preferences.hiddenSections.includes(id)} onChange={(event) => field("hiddenSections", event.target.checked ? [...preferences.hiddenSections, id] : preferences.hiddenSections.filter((item) => item !== id))} />{id}</label>)}</fieldset>
      </div>
      <button type="button" className="eo-secondary-button" disabled={busy || generating || syncStatus !== "saved" || !expectedRevision} onClick={() => void forget()}><Trash2 /> Clear saved choices for this scope</button>
    </details>
    <div className="eo-design-actions"><button type="button" className="eo-primary-button" disabled={busy || generating || syncStatus !== "saved"} onClick={() => void save(true)}>{busy || generating ? <><RefreshCw className="spin" /> Applying changes</> : <><Sparkles /> Apply changes &amp; regenerate</>}</button><button type="button" className="eo-secondary-button" disabled={busy || generating || syncStatus !== "saved"} onClick={() => void save(false)}><Check /> Save preferences</button></div>
    {notice && <p className="eo-design-notice" role="status">{notice}</p>}{error && <p className="eo-error" role="alert">{error}</p>}
    {remembered?.requests.length ? <details className="eo-design-history"><summary>Remembered change requests ({remembered.requests.length})</summary><ol>{remembered.requests.map((request, index) => <li key={`${request.at}-${index}`}>{request.text}</li>)}</ol></details> : null}
  </section>;
}
