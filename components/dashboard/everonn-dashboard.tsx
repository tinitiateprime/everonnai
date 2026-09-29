"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bell,
  BookOpenCheck,
  Bot,
  CalendarCheck,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  ContactRound,
  CreditCard,
  ExternalLink,
  Globe2,
  Headphones,
  Inbox,
  LayoutDashboard,
  Menu,
  MessageSquareText,
  Mic,
  MicOff,
  PhoneCall,
  Play,
  Plus,
  RefreshCw,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { useConversation } from "@elevenlabs/react";
import { useEverOnnWorkspace } from "@/features/everonn/workspace-provider";
import type { BusinessProfile, TeamMember, TranscriptMessage, WebsiteProject } from "@/features/everonn/types";
import { extractCallerDetails, respondToTypedCall } from "@/features/voice-agent/engine";

const sections = [
  ["overview", "Overview", LayoutDashboard],
  ["inbox", "Inbox", Inbox],
  ["contacts", "Contacts", ContactRound],
  ["calls", "Calls", PhoneCall],
  ["appointments", "Appointments", CalendarCheck],
  ["knowledge", "Knowledge", BookOpenCheck],
  ["ai-agent", "AI agent", Bot],
  ["website", "Website", Globe2],
  ["billing", "Billing", CreditCard],
  ["settings", "Settings", Settings],
] as const;

type SectionKey = (typeof sections)[number][0];

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
  } catch {
    return value;
  }
}

function ChannelIcon({ channel }: { channel: "phone" | "chat" | "website" }) {
  if (channel === "phone") return <PhoneCall />;
  if (channel === "chat") return <MessageSquareText />;
  return <Globe2 />;
}

function StatusPill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "good" | "warning" | "danger" }) {
  return <span className={`eo-status eo-status-${tone}`}>{children}</span>;
}

export function EverOnnDashboard({ initialSection }: { initialSection: string }) {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const active = (sections.some(([key]) => key === initialSection) ? initialSection : "overview") as SectionKey;
  const { workspace } = useEverOnnWorkspace();

  function navigate(section: SectionKey) {
    router.push(section === "overview" ? "/dashboard" : `/dashboard/${section}`);
    setMobileOpen(false);
  }

  return (
    <div className="eo-app">
      <aside className={`eo-sidebar ${mobileOpen ? "is-open" : ""}`}>
        <div className="eo-sidebar-brand">
          <Link href="/" aria-label="EverOnn home"><span className="eo-brand-mark">∞</span><strong>EverOnn<span>.Ai</span></strong></Link>
          <button className="eo-sidebar-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X /></button>
        </div>
        <div className="eo-workspace-switcher">
          <span>Workspace</span>
          <strong>{workspace.profile.businessName}</strong>
          <small>{workspace.profile.verified ? "Verified business" : "Verification required"}</small>
        </div>
        <nav aria-label="Dashboard navigation">
          {sections.map(([key, label, Icon]) => (
            <button className={active === key ? "active" : ""} onClick={() => navigate(key)} key={key}>
              <Icon /><span>{label}</span>{key === "inbox" && <b>{workspace.leads.filter((lead) => lead.status === "new").length}</b>}
            </button>
          ))}
        </nav>
        <div className="eo-sidebar-bottom">
          <span className="eo-live-dot" />
          <div><strong>Customer front online</strong><small>Website, chat, and calls share one profile</small></div>
        </div>
      </aside>
      {mobileOpen && <button className="eo-sidebar-scrim" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}
      <div className="eo-main">
        <header className="eo-topbar">
          <button className="eo-mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu /></button>
          <div><span>{sections.find(([key]) => key === active)?.[1]}</span><small>One approved business profile across every channel</small></div>
          <div className="eo-top-actions"><button aria-label="Notifications"><Bell /><i /></button><Link href="/preview/demo" target="_blank">Customer view <ExternalLink /></Link><span className="eo-avatar">AM</span></div>
        </header>
        <main className="eo-content">
          {active === "overview" && <Overview />}
          {active === "inbox" && <InboxSection />}
          {active === "contacts" && <ContactsSection />}
          {active === "calls" && <CallsSection />}
          {active === "appointments" && <AppointmentsSection />}
          {active === "knowledge" && <KnowledgeSection />}
          {active === "ai-agent" && <AiAgentSection />}
          {active === "website" && <WebsiteSection />}
          {active === "billing" && <BillingSection />}
          {active === "settings" && <SettingsSection />}
        </main>
      </div>
    </div>
  );
}

function PageHeading({ eyebrow, title, copy, action }: { eyebrow: string; title: string; copy: string; action?: React.ReactNode }) {
  return <div className="eo-page-heading"><div><span>{eyebrow}</span><h1>{title}</h1><p>{copy}</p></div>{action}</div>;
}

function Overview() {
  const { workspace } = useEverOnnWorkspace();
  const newLeads = workspace.leads.filter((lead) => lead.status === "new").length;
  const urgent = workspace.leads.filter((lead) => lead.urgency === "high" && lead.status !== "closed").length;
  return <>
    <PageHeading eyebrow="Today at a glance" title={`Good morning, ${workspace.team[0]?.name.split(" ")[0] || "there"}.`} copy="Every customer channel is using the same approved business information." action={<Link className="eo-primary-button" href="/dashboard/ai-agent"><Play /> Test the AI front desk</Link>} />
    <section className="eo-metrics">
      <article><span><Inbox /></span><div><small>New opportunities</small><strong>{newLeads}</strong><p>Ready for review</p></div></article>
      <article><span><PhoneCall /></span><div><small>Conversations</small><strong>{workspace.conversations.length}</strong><p>Phone, chat, and web</p></div></article>
      <article><span><CalendarCheck /></span><div><small>Appointments</small><strong>{workspace.appointments.length}</strong><p>Requested or confirmed</p></div></article>
      <article><span className={urgent ? "danger" : ""}><CircleAlert /></span><div><small>Urgent handoffs</small><strong>{urgent}</strong><p>{urgent ? "Needs a person" : "Nothing waiting"}</p></div></article>
    </section>
    <div className="eo-overview-grid">
      <section className="eo-panel eo-opportunities">
        <div className="eo-panel-heading"><div><span>Opportunity inbox</span><h2>Recent customer requests</h2></div><Link href="/dashboard/inbox">View all <ChevronRight /></Link></div>
        <div className="eo-list">
          {workspace.leads.slice(0, 4).map((lead) => <article key={lead.id}><span className={`eo-source eo-source-${lead.source}`}><ChannelIcon channel={lead.source} /></span><div><strong>{lead.callerName || "New customer"}</strong><p>{lead.reason}</p><small>{formatDate(lead.createdAt)}</small></div><StatusPill tone={lead.urgency === "high" ? "danger" : lead.status === "new" ? "warning" : "good"}>{lead.urgency === "high" ? "Urgent" : lead.status.replace("_", " ")}</StatusPill></article>)}
        </div>
      </section>
      <section className="eo-panel eo-channel-health">
        <div className="eo-panel-heading"><div><span>Customer front</span><h2>Channel readiness</h2></div></div>
        {[["Website", workspace.websiteProject?.status === "published" ? "Live" : "Preview ready", Globe2], ["AI website chat", "Ready", MessageSquareText], ["AI phone", workspace.integrations.elevenLabs === "ready" ? "Live provider" : "Demo mode", Headphones], ["Google Calendar", workspace.integrations.googleCalendar === "connected" ? "Connected" : "Not connected", CalendarCheck]].map(([label, state, Icon]) => <div className="eo-health-row" key={String(label)}><span><Icon /></span><div><strong>{String(label)}</strong><small>{String(state)}</small></div><i className={String(state).includes("Not") ? "off" : ""} /></div>)}
        <Link className="eo-secondary-button" href="/dashboard/settings">Manage connections</Link>
      </section>
    </div>
    <section className="eo-panel eo-brain-card">
      <div className="eo-brain-icon"><Sparkles /></div><div><span>One business brain</span><h2>{workspace.profile.knowledge.filter((item) => item.approved).length} approved knowledge answers power every channel.</h2><p>Changes to services, hours, policies, and handoff rules flow to website, chat, and voice from one controlled profile.</p></div><Link className="eo-secondary-button" href="/dashboard/knowledge">Review knowledge</Link>
    </section>
  </>;
}

function InboxSection() {
  const { workspace } = useEverOnnWorkspace();
  return <><PageHeading eyebrow="Unified conversations" title="Every opportunity, in one inbox." copy="Phone calls, website chats, and forms become organized customer conversations with clear next steps." /><section className="eo-panel"><div className="eo-toolbar"><div className="eo-filter active">All <b>{workspace.leads.length}</b></div><div className="eo-filter">New <b>{workspace.leads.filter((item) => item.status === "new").length}</b></div><div className="eo-filter">Needs follow-up</div></div><div className="eo-table-wrap"><table className="eo-table"><thead><tr><th>Customer</th><th>Channel</th><th>Request</th><th>Urgency</th><th>Status</th><th>Received</th></tr></thead><tbody>{workspace.leads.map((lead) => <tr key={lead.id}><td><strong>{lead.callerName}</strong><small>{lead.callerPhone}</small></td><td><span className="eo-inline-channel"><ChannelIcon channel={lead.source} /> {lead.source}</span></td><td>{lead.reason}</td><td><StatusPill tone={lead.urgency === "high" ? "danger" : "neutral"}>{lead.urgency}</StatusPill></td><td><StatusPill tone={lead.status === "new" ? "warning" : "good"}>{lead.status.replace("_", " ")}</StatusPill></td><td>{formatDate(lead.createdAt)}</td></tr>)}</tbody></table></div></section></>;
}

function ContactsSection() {
  const { workspace } = useEverOnnWorkspace();
  return <><PageHeading eyebrow="Customer context" title="Contacts that carry the conversation forward." copy="Keep callback details and recent activity connected to the inquiry instead of scattered across tools." action={<button className="eo-primary-button"><Plus /> Add contact</button>} /><section className="eo-panel"><div className="eo-contact-grid">{workspace.contacts.map((contact) => <article key={contact.id}><span>{contact.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span><div><h3>{contact.name}</h3><p>{contact.phone}</p><small>{contact.email || "Email not provided"}</small></div><button aria-label={`Open ${contact.name}`}><ChevronRight /></button></article>)}</div></section></>;
}

function CallsSection() {
  const { workspace } = useEverOnnWorkspace();
  return <><PageHeading eyebrow="Call history" title="Every call leaves a useful next step." copy="Review summaries, urgency, callback details, and handoff status captured by the AI front desk." action={<Link className="eo-primary-button" href="/dashboard/ai-agent"><PhoneCall /> Start a test call</Link>} /><section className="eo-panel"><div className="eo-table-wrap"><table className="eo-table"><thead><tr><th>Caller</th><th>Summary</th><th>Urgency</th><th>Outcome</th><th>Time</th></tr></thead><tbody>{workspace.conversations.filter((item) => item.channel === "phone").map((call) => <tr key={call.id}><td><strong>{call.contactName || "Unknown caller"}</strong><small>{call.contactPhone || "No number captured"}</small></td><td>{call.summary}</td><td><StatusPill tone={call.urgency === "high" ? "danger" : "neutral"}>{call.urgency}</StatusPill></td><td>{call.status === "handoff" ? "Human callback" : "Captured"}</td><td>{formatDate(call.createdAt)}</td></tr>)}</tbody></table></div></section></>;
}

function AppointmentsSection() {
  const { workspace, setIntegration } = useEverOnnWorkspace();
  const connected = workspace.integrations.googleCalendar === "connected";
  return <><PageHeading eyebrow="Booking & requests" title="Keep appointment intent attached to the customer." copy="The AI records requested times and confirms a booking only when a connected calendar accepts it." action={<button className={connected ? "eo-secondary-button" : "eo-primary-button"} onClick={() => setIntegration("googleCalendar", connected ? "disconnected" : "connected")}><CalendarCheck /> {connected ? "Calendar connected" : "Connect Google Calendar"}</button>} /><div className="eo-notice"><ShieldCheck /><div><strong>No invented availability</strong><p>Without a verified calendar result, EverOnn saves an unconfirmed request and asks the team to follow up.</p></div></div><section className="eo-panel"><div className="eo-appointment-grid">{workspace.appointments.map((appointment) => <article key={appointment.id}><div className="eo-date-block"><strong>{new Date(`${appointment.date}T00:00:00`).toLocaleDateString("en", { day: "2-digit" })}</strong><span>{new Date(`${appointment.date}T00:00:00`).toLocaleDateString("en", { month: "short" })}</span></div><div><h3>{appointment.service}</h3><p>{appointment.contactName} · {appointment.contactPhone}</p><small>{appointment.time} · {workspace.profile.timeZone}</small></div><StatusPill tone={appointment.status === "confirmed" ? "good" : "warning"}>{appointment.status}</StatusPill></article>)}</div></section></>;
}

function KnowledgeSection() {
  const { workspace, updateProfile, syncStatus } = useEverOnnWorkspace();
  const profile = workspace.profile;
  function field<K extends keyof BusinessProfile>(key: K, value: BusinessProfile[K]) { updateProfile({ [key]: value } as Pick<BusinessProfile, K>); }
  const saveLabel = syncStatus === "loading" ? "Loading JSON" : syncStatus === "saving" ? "Saving JSON" : syncStatus === "error" ? "JSON save failed" : "Saved to JSON";
  const saveIcon = syncStatus === "loading" || syncStatus === "saving" ? <RefreshCw className="spin" /> : syncStatus === "error" ? <CircleAlert /> : <CheckCircle2 />;
  return <><PageHeading eyebrow="Approved business knowledge" title="Enter business facts once. Use them everywhere." copy="Website, chat, and phone answer from the same controlled profile. Only approved information reaches customers." action={<span className={`eo-save-state ${syncStatus === "error" ? "is-error" : ""}`}>{saveIcon} {saveLabel}</span>} /><div className="eo-knowledge-layout"><section className="eo-panel eo-profile-form"><div className="eo-panel-heading"><div><span>Business profile</span><h2>Core information</h2></div><StatusPill tone={profile.verified ? "good" : "warning"}>{profile.verified ? "Owner verified" : "Needs verification"}</StatusPill></div><div className="eo-form-grid"><label>Business name<input value={profile.businessName} onChange={(event) => field("businessName", event.target.value)} /></label><label>Business type<input value={profile.businessType} onChange={(event) => field("businessType", event.target.value)} /></label><label className="wide">Description<textarea rows={4} value={profile.description} onChange={(event) => field("description", event.target.value)} /></label><label>Business phone<input value={profile.phone} onChange={(event) => field("phone", event.target.value)} /></label><label>Follow-up email<input type="email" value={profile.email} onChange={(event) => field("email", event.target.value)} /></label><label>Location<input value={profile.location} onChange={(event) => field("location", event.target.value)} /></label><label>Service area<input value={profile.serviceArea} onChange={(event) => field("serviceArea", event.target.value)} /></label><label className="wide">Business hours<textarea rows={2} value={profile.hours} onChange={(event) => field("hours", event.target.value)} /></label></div></section><aside className="eo-panel eo-knowledge-score"><span>Knowledge readiness</span><div className="eo-score-ring"><strong>{profile.verified ? "92" : "68"}</strong><small>%</small></div><ul><li><Check /> Core business facts</li><li><Check /> Services and coverage</li><li><Check /> Customer handoff rules</li><li className={profile.knowledge.length >= 5 ? "" : "muted"}><Check /> Five or more FAQs</li></ul></aside></div><section className="eo-panel eo-kb-list"><div className="eo-panel-heading"><div><span>Shared knowledge base</span><h2>Approved answers</h2></div><button className="eo-secondary-button"><Plus /> Add answer</button></div>{profile.knowledge.map((item) => <article key={item.id}><div><span>{item.category}</span><h3>{item.question}</h3><p>{item.answer}</p></div><StatusPill tone={item.approved ? "good" : "warning"}>{item.approved ? "Approved" : "Draft"}</StatusPill></article>)}</section></>;
}

function AiAgentSection() {
  const { workspace, addConversation, addLead, setIntegration } = useEverOnnWorkspace();
  const profile = workspace.profile;
  const [messages, setMessages] = useState<TranscriptMessage[]>([{ id: "welcome", role: "assistant", text: profile.greeting, at: new Date().toISOString() }]);
  const [input, setInput] = useState("");
  const [saved, setSaved] = useState(false);
  const [startingVoice, setStartingVoice] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const liveVoice = useConversation({
    onConnect() {
      setIntegration("elevenLabs", "ready");
      setStartingVoice(false);
      setVoiceError("");
    },
    onDisconnect() {
      setStartingVoice(false);
    },
    onError(message) {
      setStartingVoice(false);
      setVoiceError(message || "The ElevenLabs session could not be started.");
    },
    onMessage(event) {
      const role = event.role === "agent" ? "assistant" : "caller";
      setMessages((current) => {
        const previous = current.at(-1);
        if (previous?.role === role && previous.text === event.message) return current;
        return [...current, { id: crypto.randomUUID(), role, text: event.message, at: new Date().toISOString() }];
      });
    },
  });
  const live = liveVoice.status === "connected" || liveVoice.status === "connecting";

  function speak(value: string) {
    window.speechSynthesis.cancel();
    const speech = new SpeechSynthesisUtterance(value);
    speech.rate = 0.96;
    window.speechSynthesis.speak(speech);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = input.trim();
    if (!value) return;
    const caller: TranscriptMessage = { id: crypto.randomUUID(), role: "caller", text: value, at: new Date().toISOString() };
    if (live) {
      setMessages((current) => [...current, caller]);
      liveVoice.sendUserMessage(value);
      setInput("");
      return;
    }
    const response = respondToTypedCall(profile, messages, value);
    const assistant: TranscriptMessage = { id: crypto.randomUUID(), role: "assistant", text: response.reply, at: new Date().toISOString() };
    setMessages((current) => [...current, caller, assistant]);
    setInput("");
    speak(response.reply);
  }

  async function startLiveVoice() {
    setStartingVoice(true);
    setVoiceError("");
    try {
      const permission = await navigator.mediaDevices.getUserMedia({ audio: true });
      permission.getTracks().forEach((track) => track.stop());
      const response = await fetch("/api/voice/session", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-everonn-workspace": workspace.workspaceId },
        body: JSON.stringify({}),
      });
      const data = await response.json() as { conversationToken?: string; dynamicVariables?: Record<string, string>; error?: string };
      if (!response.ok || !data.conversationToken) throw new Error(data.error || "Unable to create the ElevenLabs session.");
      liveVoice.startSession({ conversationToken: data.conversationToken, connectionType: "webrtc", dynamicVariables: data.dynamicVariables });
    } catch (error) {
      setStartingVoice(false);
      setVoiceError(error instanceof Error ? error.message : "Microphone access or ElevenLabs setup failed.");
    }
  }

  function resetConversation() {
    if (live) liveVoice.endSession();
    setMessages([{ id: crypto.randomUUID(), role: "assistant", text: profile.greeting, at: new Date().toISOString() }]);
    setSaved(false);
    setVoiceError("");
  }

  function saveCall() {
    const details = extractCallerDetails(messages);
    const callerText = messages.filter((item) => item.role === "caller").map((item) => item.text).join(" ");
    const now = new Date().toISOString();
    const conversationId = `conv_${crypto.randomUUID()}`;
    addConversation({ id: conversationId, workspaceId: workspace.workspaceId, channel: "phone", status: details.urgency === "high" ? "handoff" : "completed", contactName: details.callerName, contactPhone: details.callerPhone, summary: callerText.slice(0, 300) || "Test call completed", urgency: details.urgency, messages, createdAt: now });
    addLead({ id: `lead_${crypto.randomUUID()}`, workspaceId: workspace.workspaceId, callerName: details.callerName || "Test caller", callerPhone: details.callerPhone, reason: callerText.slice(0, 180) || "Test call", source: "phone", urgency: details.urgency, status: "new", createdAt: now });
    setSaved(true);
  }

  return <>
    <PageHeading eyebrow="AI phone front desk" title="Test the receptionist against approved facts." copy="Start a real ElevenLabs microphone conversation or use the safe typed demo. Both share the approved business profile and handoff rules." />
    {voiceError && <div className="eo-error"><CircleAlert /> {voiceError}</div>}
    <div className="eo-agent-grid">
      <section className="eo-panel eo-agent-profile">
        <div className={`eo-agent-avatar ${liveVoice.isSpeaking ? "is-speaking" : ""}`}><Bot /></div>
        <h2>{profile.assistantName}</h2>
        <p>AI front desk for {profile.businessName}</p>
        <div className={`eo-agent-ready ${live ? "is-live" : ""}`}><i /> {liveVoice.status === "connected" ? (liveVoice.isSpeaking ? "AI is speaking" : "Listening to you") : liveVoice.status === "connecting" || startingVoice ? "Connecting securely…" : "Ready for a live conversation"}</div>
        <div className="eo-live-voice-controls">
          {!live ? <button className="eo-primary-button" onClick={startLiveVoice} disabled={startingVoice}><Mic /> {startingVoice ? "Connecting" : "Start live voice"}</button> : <button className="eo-stop-voice" onClick={() => liveVoice.endSession()}><MicOff /> End live voice</button>}
        </div>
        <dl>
          <div><dt>Voice provider</dt><dd>{workspace.integrations.elevenLabs === "ready" || live ? "ElevenLabs" : "Typed demo"}</dd></div>
          <div><dt>Approved services</dt><dd>{profile.services.filter((item) => item.active).length}</dd></div>
          <div><dt>Knowledge answers</dt><dd>{profile.knowledge.filter((item) => item.approved).length}</dd></div>
          <div><dt>Human handoff</dt><dd>{profile.transferNumber ? "Configured" : "Callback only"}</dd></div>
        </dl>
        <Link className="eo-secondary-button" href="/dashboard/knowledge">Edit approved information</Link>
      </section>
      <section className="eo-panel eo-agent-console">
        <header>
          <div><span className="eo-live-dot" /><div><strong>{live ? "Live ElevenLabs conversation" : "Safe typed demonstration"}</strong><small>{live ? "Microphone and speaker are active" : "Not connected to a public phone line"}</small></div></div>
          <button onClick={resetConversation}><RefreshCw /> Reset</button>
        </header>
        <div className="eo-transcript">{messages.map((message) => <div className={message.role} key={message.id}><span>{message.role === "assistant" ? profile.assistantName : "Caller"}</span><p>{message.text}</p></div>)}</div>
        <form onSubmit={submit}><input value={input} onChange={(event) => setInput(event.target.value)} placeholder={live ? "Send a text message into the live call…" : "Try: My name is Chris and my furnace is smoking…"} /><button aria-label="Send"><Send /></button></form>
        <footer><small>{live ? "Live transcript is captured for the inbox summary." : "Browser speech reads demo replies aloud."}</small><button className="eo-primary-button" onClick={saveCall} disabled={saved || messages.length < 3}>{saved ? <><Check /> Saved to inbox</> : "Finish & save summary"}</button></footer>
      </section>
    </div>
  </>;
}

function WebsiteSection() {
  const { workspace, setWebsiteProject, advanceWebsiteProject } = useEverOnnWorkspace();
  const project = workspace.websiteProject;
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  async function generate() {
    setGenerating(true); setError("");
    try {
      const response = await fetch("/api/website-studio", { method: "POST", headers: { "Content-Type": "application/json", "x-everonn-workspace": workspace.workspaceId }, body: JSON.stringify({ profile: workspace.profile }) });
      const data = await response.json() as { project?: WebsiteProject; error?: string };
      if (!response.ok || !data.project) throw new Error(data.error || "Unable to generate the website project.");
      setWebsiteProject(data.project);
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "Unable to generate the website project.");
    } finally { setGenerating(false); }
  }

  return <><PageHeading eyebrow="AI Website Studio" title="Generate, verify, and publish from the same business profile." copy="Three private concepts are generated from approved facts and held behind owner claim, verification, and approval gates." action={<button className="eo-primary-button" onClick={generate} disabled={generating}>{generating ? <><RefreshCw className="spin" /> Generating</> : <><Sparkles /> {project ? "Regenerate concepts" : "Generate three concepts"}</>}</button>} />{error && <div className="eo-error"><CircleAlert /> {error}</div>}{!project ? <section className="eo-panel eo-empty-studio"><div><Globe2 /></div><h2>Your private website concepts begin here.</h2><p>EverOnn will use {workspace.profile.services.filter((item) => item.active).length} active services, {workspace.profile.knowledge.filter((item) => item.approved).length} approved answers, and the verified business profile.</p><button className="eo-primary-button" onClick={generate}><Sparkles /> Generate website</button></section> : <WebsiteProjectView project={project} advance={advanceWebsiteProject} />}</>;
}

function WebsiteProjectView({ project, advance }: { project: WebsiteProject; advance: (status: WebsiteProject["status"], concept?: WebsiteProject["selectedConcept"]) => void }) {
  const [concept, setConcept] = useState<"editorial" | "momentum" | "aura">(project.selectedConcept || "editorial");
  const stepIndex = ["generated", "claimed", "verified", "approved", "published"].indexOf(project.status);
  const next = ["claimed", "verified", "approved", "published"][Math.max(0, stepIndex)] as WebsiteProject["status"] | undefined;
  const actionLabels: Partial<Record<WebsiteProject["status"], string>> = { generated: "Claim this preview", claimed: "Verify business owner", verified: "Approve for publishing", approved: "Publish website" };
  return <><section className="eo-panel eo-project-status"><div><span>Private preview workflow</span><h2>{project.spec.hero.headline}</h2><p>Created {formatDate(project.createdAt)} · Token-protected preview</p></div><StatusPill tone={project.status === "published" ? "good" : "warning"}>{project.status}</StatusPill><ol>{["Generated", "Claimed", "Owner verified", "Approved", "Published"].map((label, index) => <li className={index <= stepIndex ? "done" : ""} key={label}><i>{index < stepIndex ? <Check /> : index + 1}</i><span>{label}</span></li>)}</ol></section><div className="eo-studio-grid"><section className="eo-panel eo-concept-panel"><div className="eo-concept-tabs">{project.concepts.map((item) => <button className={concept === item ? "active" : ""} onClick={() => setConcept(item)} key={item}>{item}</button>)}</div><div className={`eo-site-mini eo-site-${concept}`}><header><strong>{project.spec.brand.tagline}</strong><span>Services · About · Contact</span></header><div className="eo-site-hero"><small>{project.spec.hero.eyebrow}</small><h2>{project.spec.hero.headline}</h2><p>{project.spec.hero.subheadline}</p><button>{project.spec.hero.primaryCta}</button></div><div className="eo-site-services">{project.spec.services.slice(0, 3).map((service) => <article key={service.id}><span>0{project.spec.services.indexOf(service) + 1}</span><strong>{service.name}</strong><p>{service.summary}</p></article>)}</div></div><div className="eo-concept-actions"><button className="eo-secondary-button" onClick={() => advance(project.status, concept)}><Check /> Select {concept}</button><Link className="eo-primary-button" href={`/preview/${project.privateToken}?theme=${concept}`} target="_blank">Open private preview <ExternalLink /></Link></div></section><aside className="eo-panel eo-qa-panel"><span>Website QA</span><div className={`eo-qa-result ${project.qa.passed ? "passed" : "failed"}`}>{project.qa.passed ? <CheckCircle2 /> : <CircleAlert />}<div><strong>{project.qa.passed ? "All checks passed" : "Action required"}</strong><small>{project.qa.checks.filter((item) => item.passed).length} of {project.qa.checks.length} checks</small></div></div>{project.qa.checks.map((check) => <div className="eo-qa-check" key={check.key}>{check.passed ? <Check /> : <X />}<span>{check.message}</span></div>)}{next && <button className="eo-primary-button eo-wide" onClick={() => advance(next, concept)}>{actionLabels[project.status]} <ChevronRight /></button>}{project.status === "published" && <a className="eo-primary-button eo-wide" href={`/preview/${project.privateToken}?theme=${concept}`} target="_blank">View published site <ExternalLink /></a>}</aside></div></>;
}

function BillingSection() {
  return <><PageHeading eyebrow="Plan & usage" title="Simple pricing tied to customer response." copy="The current workspace is using the Front Desk pilot configuration." /><section className="eo-panel eo-billing"><div><span>Current plan</span><h2>Front Desk</h2><p>Website, AI phone answering, AI website chat, lead inbox, and included usage.</p></div><strong><sup>$</sup>79<small>/month</small></strong><button className="eo-secondary-button">Manage plan</button></section><div className="eo-billing-grid"><section className="eo-panel"><span>This billing period</span><h2>Usage</h2><div className="eo-usage"><div><p>Voice minutes</p><span>38 / 120</span></div><i><b style={{ width: "32%" }} /></i><div><p>AI conversations</p><span>47 / 250</span></div><i><b style={{ width: "19%" }} /></i></div></section><section className="eo-panel"><span>Next invoice</span><h2>October 29, 2026</h2><p>Payment and provider billing adapters are ready to connect to the production billing system.</p></section></div></>;
}

const roleDescriptions = { owner: "Full workspace, team, billing, and publishing control", manager: "Configure business channels and handle customers", agent: "Operate inbox, calls, contacts, and appointments", viewer: "Read-only workspace access" } as const;

function SettingsSection() {
  const router = useRouter();
  const { workspace, setIntegration, updateTeamMember, resetDemo } = useEverOnnWorkspace();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<TeamMember["role"]>("agent");
  const [connections, setConnections] = useState({ loading: true, googleConfigured: false, googleConnected: false, calendarConnected: false, gmailConnected: false, elevenLabsConfigured: false, error: "" });

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const [googleResponse, voiceResponse] = await Promise.all([
          fetch("/api/integrations/google", { headers: { "x-everonn-workspace": workspace.workspaceId }, cache: "no-store", signal: controller.signal }),
          fetch("/api/voice/session", { cache: "no-store", signal: controller.signal }),
        ]);
        const google = await googleResponse.json() as { configured?: boolean; connected?: boolean; calendar?: boolean; gmail?: boolean; error?: string };
        const voice = await voiceResponse.json() as { configured?: boolean };
        if (!googleResponse.ok) throw new Error(google.error || "Unable to read provider status.");
        setConnections({ loading: false, googleConfigured: Boolean(google.configured), googleConnected: Boolean(google.connected), calendarConnected: Boolean(google.calendar), gmailConnected: Boolean(google.gmail), elevenLabsConfigured: Boolean(voice.configured), error: "" });
      } catch (error) {
        if ((error as Error).name !== "AbortError") setConnections((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : "Unable to read provider status." }));
      }
    }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [workspace.workspaceId]);

  function connectGoogle() {
    router.push(`/api/integrations/google/connect?workspaceId=${encodeURIComponent(workspace.workspaceId)}`);
  }

  async function disconnectGoogle() {
    setConnections((current) => ({ ...current, loading: true, error: "" }));
    try {
      const response = await fetch("/api/integrations/google", { method: "DELETE", headers: { "x-everonn-workspace": workspace.workspaceId } });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Unable to disconnect Google.");
      setIntegration("googleCalendar", "disconnected");
      setIntegration("gmail", "disconnected");
      setConnections((current) => ({ ...current, loading: false, googleConnected: false, calendarConnected: false, gmailConnected: false }));
    } catch (error) {
      setConnections((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : "Unable to disconnect Google." }));
    }
  }

  function invite(event: FormEvent) { event.preventDefault(); if (!inviteEmail.trim()) return; updateTeamMember({ id: `member_${crypto.randomUUID()}`, name: inviteEmail.split("@")[0], email: inviteEmail.trim(), role: inviteRole, status: "invited" }); setInviteEmail(""); }
  return <>
    <PageHeading eyebrow="Workspace controls" title="Team access and connected systems." copy="Roles are workspace-scoped so one customer’s data never appears in another workspace." />
    {connections.error && <div className="eo-error"><CircleAlert /> {connections.error}</div>}
    <div className="eo-settings-grid">
      <section className="eo-panel">
        <div className="eo-panel-heading"><div><span>Connections</span><h2>Customer workflow</h2></div></div>
        <div className="eo-connection"><span><CalendarCheck /></span><div><strong>Google Calendar</strong><small>{connections.calendarConnected ? "Connected with encrypted OAuth tokens" : "Check availability and create confirmed appointments"}</small></div><button disabled={connections.loading || !connections.googleConfigured} onClick={connections.googleConnected ? disconnectGoogle : connectGoogle}>{connections.loading ? "Checking…" : !connections.googleConfigured ? "Needs setup" : connections.calendarConnected ? "Disconnect" : "Connect"}</button></div>
        <div className="eo-connection"><span><Send /></span><div><strong>Gmail</strong><small>{connections.gmailConnected ? "Connected through the same approved Google account" : "Send call summaries and urgent alerts"}</small></div><button disabled={connections.loading || !connections.googleConfigured} onClick={connections.googleConnected ? disconnectGoogle : connectGoogle}>{connections.gmailConnected ? "Disconnect" : "Connect Google"}</button></div>
        <div className="eo-connection"><span><Headphones /></span><div><strong>ElevenLabs</strong><small>{connections.elevenLabsConfigured ? "API key and agent are ready for live browser voice" : "Add the API key and Agent ID to enable live voice"}</small></div><button disabled={!connections.elevenLabsConfigured} onClick={() => router.push("/dashboard/ai-agent")}>{connections.elevenLabsConfigured ? "Open live voice" : "Needs setup"}</button></div>
      </section>
      <section className="eo-panel"><div className="eo-panel-heading"><div><span>Role permissions</span><h2>Workspace RBAC</h2></div></div>{Object.entries(roleDescriptions).map(([role, copy]) => <div className="eo-role" key={role}><strong>{role}</strong><p>{copy}</p></div>)}</section>
    </div>
    <section className="eo-panel eo-team-panel"><div className="eo-panel-heading"><div><span>Workspace team</span><h2>Members and invitations</h2></div></div><div className="eo-table-wrap"><table className="eo-table"><thead><tr><th>Member</th><th>Role</th><th>Status</th><th>Access</th></tr></thead><tbody>{workspace.team.map((member) => <tr key={member.id}><td><strong>{member.name}</strong><small>{member.email}</small></td><td><select value={member.role} onChange={(event) => updateTeamMember({ ...member, role: event.target.value as TeamMember["role"] })}><option value="owner">Owner</option><option value="manager">Manager</option><option value="agent">Agent</option><option value="viewer">Viewer</option></select></td><td><StatusPill tone={member.status === "active" ? "good" : "warning"}>{member.status}</StatusPill></td><td>{roleDescriptions[member.role]}</td></tr>)}</tbody></table></div><form className="eo-invite-form" onSubmit={invite}><input type="email" required value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="teammate@business.com" /><select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as TeamMember["role"])}><option value="manager">Manager</option><option value="agent">Agent</option><option value="viewer">Viewer</option></select><button className="eo-primary-button"><Users /> Send invitation</button></form></section>
    <section className="eo-danger-zone"><div><strong>Reset JSON workspace</strong><p>Restore the original demo business, conversations, and configuration in the JSON file.</p></div><button onClick={resetDemo}>Reset demo</button></section>
  </>;
}
