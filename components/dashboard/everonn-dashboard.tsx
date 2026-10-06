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
  Gauge,
  FolderGit2,
  Headphones,
  Inbox,
  LayoutDashboard,
  LogOut,
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
  Trash2,
  Users,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useConversation } from "@elevenlabs/react";
import { useEverOnnWorkspace } from "@/features/everonn/workspace-provider";
import type { BusinessProfile, Lead, TeamMember, TranscriptMessage, WebsiteProject } from "@/features/everonn/types";
import { readWebsiteGeneration, type WebsiteGenerationProgress } from "@/features/website-studio/progress";
import { hasCapability } from "@/features/auth/rbac";
import type { AuthActor } from "@/features/auth/types";
import { extractCallerDetails } from "@/features/voice-agent/engine";
import { createLeadCaptureQueue } from "@/features/voice-agent/capture-client";
import type { LeadCaptureInput } from "@/features/everonn/lead-capture";
import { AppointmentFields } from "@/components/booking/appointment-fields";
import { isSampleAppointment } from "@/features/everonn/sample-records";
import { bookingToolResult } from "@/features/voice-agent/session-context";
import { notifyElevenLabsUsage } from "@/features/usage/client";
import { UsageSection } from "@/components/dashboard/usage-section";
import { DOMAIN_SKILLS } from "@/features/agent-runtime/skill-registry";
import { WebsiteDesignEditor } from "@/components/dashboard/website-design-editor";

const sections = [
  ["overview", "Overview", LayoutDashboard],
  ["inbox", "Inbox", Inbox],
  ["contacts", "Contacts", ContactRound],
  ["calls", "Calls", PhoneCall],
  ["appointments", "Appointments", CalendarCheck],
  ["knowledge", "Knowledge", BookOpenCheck],
  ["ai-agent", "AI agent", Bot],
  ["website", "Website", Globe2],
  ["usage", "Usage", Gauge],
  ["billing", "Billing", CreditCard],
  ["settings", "Settings", Settings],
] as const;

type SectionKey = (typeof sections)[number][0];

function canOpenSection(actor: AuthActor, section: SectionKey) {
  if (["overview", "inbox", "contacts", "calls", "appointments", "settings"].includes(section)) return hasCapability(actor.role, "workspace:view");
  if (section === "knowledge") return hasCapability(actor.role, "business:configure");
  if (section === "ai-agent") return hasCapability(actor.role, "calls:operate");
  if (section === "website") return hasCapability(actor.role, "website:publish");
  if (section === "billing") return hasCapability(actor.role, "billing:manage");
  if (section === "usage") return hasCapability(actor.role, "usage:view");
  return false;
}

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

export function EverOnnDashboard({ initialSection, actor }: { initialSection: string; actor: AuthActor }) {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const requested = (sections.some(([key]) => key === initialSection) ? initialSection : "overview") as SectionKey;
  const active = canOpenSection(actor, requested) ? requested : "overview";
  const { workspace, hydrated, persistenceReady } = useEverOnnWorkspace();

  function navigate(section: SectionKey) {
    router.push(section === "overview" ? "/dashboard" : `/dashboard/${section}`);
    setMobileOpen(false);
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/login");
    router.refresh();
  }

  if (!hydrated) return <main className="eo-content" role="status">Loading your workspace…</main>;
  if (!persistenceReady) return <main className="eo-content"><p role="alert">Your workspace could not be loaded. Reload the page to retry.</p><button className="eo-primary-button" onClick={() => window.location.reload()}>Reload workspace</button></main>;

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
          <Link className="eo-project-workspace-link" href="/workspace"><FolderGit2 /><span>Project workspace</span></Link>
          {sections.filter(([key]) => canOpenSection(actor, key)).map(([key, label, Icon]) => (
            <button className={active === key ? "active" : ""} onClick={() => navigate(key)} key={key}>
              <Icon /><span>{label}</span>{key === "inbox" && <b>{workspace.leads.filter((lead) => lead.status === "new").length}</b>}
            </button>
          ))}
        </nav>
        <div className="eo-sidebar-bottom">
          <span className="eo-live-dot" />
          <div><strong>{workspace.websiteProject?.status === "published" ? "Customer website published" : "Customer website not published"}</strong><small>Website, chat, and calls share one profile</small></div>
        </div>
      </aside>
      {mobileOpen && <button className="eo-sidebar-scrim" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}
      <div className="eo-main">
        <header className="eo-topbar">
          <button className="eo-mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu /></button>
          <div><span>{sections.find(([key]) => key === active)?.[1]}</span><small>One approved business profile across every channel</small></div>
          <div className="eo-top-actions"><Link className="eo-notifications" href="/dashboard/inbox" aria-label="View customer inbox"><Bell /></Link>{workspace.websiteProject && <Link href={`/preview/${workspace.websiteProject.privateToken}`} target="_blank">Customer view <ExternalLink /></Link>}<span className="eo-user-role">{actor.role}</span><span className="eo-avatar" title={actor.email}>{actor.name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><button className="eo-signout" onClick={() => void signOut()} aria-label="Sign out" title="Sign out"><LogOut /></button></div>
        </header>
        <main className="eo-content">
          {active === "overview" && <Overview actor={actor} />}
          {active === "inbox" && <InboxSection actor={actor} />}
          {active === "contacts" && <ContactsSection actor={actor} />}
          {active === "calls" && <CallsSection actor={actor} />}
          {active === "appointments" && <AppointmentsSection actor={actor} />}
          {active === "knowledge" && <KnowledgeSection />}
          {active === "ai-agent" && <AiAgentSection />}
          {active === "website" && <WebsiteSection />}
          {active === "billing" && <BillingSection />}
          {active === "usage" && <UsageSection workspaceId={workspace.workspaceId} />}
          {active === "settings" && <SettingsSection actor={actor} />}
        </main>
      </div>
    </div>
  );
}

function PageHeading({ eyebrow, title, copy, action }: { eyebrow: string; title: string; copy: string; action?: React.ReactNode }) {
  return <div className="eo-page-heading"><div><span>{eyebrow}</span><h1>{title}</h1><p>{copy}</p></div>{action}</div>;
}

function Overview({ actor }: { actor: AuthActor }) {
  const { workspace } = useEverOnnWorkspace();
  const newLeads = workspace.leads.filter((lead) => lead.status === "new").length;
  const urgent = workspace.leads.filter((lead) => lead.urgency === "high" && lead.status !== "closed").length;
  return <>
    <PageHeading eyebrow="Today at a glance" title={`Good morning, ${actor.name.split(" ")[0] || "there"}.`} copy={`Signed in as ${actor.role}. Every customer channel uses the same approved business information.`} action={hasCapability(actor.role, "calls:operate") ? <Link className="eo-primary-button" href="/dashboard/ai-agent"><Play /> Test the AI front desk</Link> : undefined} />
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
        {[["Website", (workspace.publishedWebsite || workspace.websiteProject?.status === "published") ? "Live" : workspace.websiteProject ? "Private preview" : "Not generated", Globe2], ["AI website chat", workspace.integrations.gemini === "ready" || workspace.integrations.elevenLabs === "ready" ? "Provider configured" : "Not configured", MessageSquareText], ["AI phone", workspace.integrations.elevenLabs === "ready" ? "Voice provider configured" : "Not configured", Headphones], ["Google Calendar", workspace.integrations.googleCalendar === "connected" ? "Connected" : "Not connected", CalendarCheck]].map(([label, state, Icon]) => <div className="eo-health-row" key={String(label)}><span><Icon /></span><div><strong>{String(label)}</strong><small>{String(state)}</small></div><i className={String(state).includes("Not") ? "off" : ""} /></div>)}
        {hasCapability(actor.role, "business:configure") && <Link className="eo-secondary-button" href="/dashboard/settings">Manage connections</Link>}
      </section>
    </div>
    <section className="eo-panel eo-brain-card">
      <div className="eo-brain-icon"><Sparkles /></div><div><span>One business brain</span><h2>{workspace.profile.knowledge.filter((item) => item.approved).length} approved knowledge answers power every channel.</h2><p>Changes to services, hours, policies, and handoff rules flow to website, chat, and voice from one controlled profile.</p></div>{hasCapability(actor.role, "business:configure") && <Link className="eo-secondary-button" href="/dashboard/knowledge">Review knowledge</Link>}
    </section>
  </>;
}

function InboxSection({ actor }: { actor: AuthActor }) {
  const { workspace, upsertLead } = useEverOnnWorkspace();
  const [filter, setFilter] = useState<"all" | "new" | "follow_up">("all");
  const needsFollowUp = (lead: Lead) => lead.status !== "closed" && (lead.status === "follow_up" || lead.urgency === "high" || ["needs_details", "unavailable", "failed"].includes(lead.automation?.appointmentStatus || "") || lead.automation?.gmailStatus === "delivery_unknown");
  const leads = workspace.leads.filter((lead) => filter === "all" || (filter === "new" ? lead.status === "new" : needsFollowUp(lead)));
  const contactDetails = (lead: Lead) => {
    const contact = workspace.contacts.find((item) => item.id === lead.contactId);
    return [lead.callerPhone, contact?.email].filter(Boolean).join(" · ") || "No contact details";
  };
  const automationDetails = (lead: Lead) => {
    if (!lead.automation) return "";
    const appointment = lead.automation.appointmentStatus === "confirmed" ? "Calendar confirmed"
      : lead.automation.appointmentStatus === "unavailable" ? "Calendar busy — follow-up required"
        : lead.automation.appointmentStatus === "needs_details" ? "Appointment needs a complete date and time"
          : lead.automation.appointmentStatus === "cancelled" ? "Appointment request cancelled"
          : lead.automation.appointmentStatus === "failed" ? "Calendar automation needs attention" : "";
    const email = lead.automation.gmailStatus === "sent" ? "Email notification sent"
      : lead.automation.gmailStatus === "delivery_unknown" ? "Email delivery unverified — check Gmail Sent"
        : lead.automation.gmailStatus === "pending" ? "Email submission reserved — check Gmail Sent before resending"
          : lead.automation.gmailStatus === "failed" ? "Email notification failed" : "";
    return [appointment, email].filter(Boolean).join(" · ");
  };
  return <><PageHeading eyebrow="Unified conversations" title="Every opportunity, in one inbox." copy="Phone calls, website chats, and forms become organized customer conversations with clear next steps." /><section className="eo-panel"><div className="eo-toolbar"><button className={`eo-filter ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>All <b>{workspace.leads.length}</b></button><button className={`eo-filter ${filter === "new" ? "active" : ""}`} onClick={() => setFilter("new")}>New <b>{workspace.leads.filter((item) => item.status === "new").length}</b></button><button className={`eo-filter ${filter === "follow_up" ? "active" : ""}`} onClick={() => setFilter("follow_up")}>Needs follow-up <b>{workspace.leads.filter(needsFollowUp).length}</b></button></div><div className="eo-table-wrap"><table className="eo-table"><thead><tr><th>Customer</th><th>Channel</th><th>Request</th><th>Urgency</th><th>Status</th><th>Received</th></tr></thead><tbody>{leads.map((lead) => <tr key={lead.id}><td><strong>{lead.callerName}</strong><small>{contactDetails(lead)}</small></td><td><span className="eo-inline-channel"><ChannelIcon channel={lead.source} /> {lead.source}</span></td><td>{lead.reason}{automationDetails(lead) && <small>{automationDetails(lead)}</small>}</td><td><StatusPill tone={lead.urgency === "high" ? "danger" : "neutral"}>{lead.urgency}</StatusPill></td><td>{hasCapability(actor.role, "inbox:operate") ? <select aria-label={`Status for ${lead.callerName}`} value={lead.status} onChange={(event) => upsertLead({ ...lead, status: event.target.value as Lead["status"] })}><option value="new">New</option><option value="qualified">Qualified</option><option value="follow_up">Follow up</option><option value="closed">Closed</option></select> : <StatusPill tone={lead.status === "new" ? "warning" : "good"}>{lead.status.replace("_", " ")}</StatusPill>}</td><td>{formatDate(lead.createdAt)}</td></tr>)}</tbody></table></div></section></>;
}

function ContactsSection({ actor }: { actor: AuthActor }) {
  const { workspace, upsertContact, syncStatus } = useEverOnnWorkspace();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  function addContact(event: FormEvent) {
    event.preventDefault();
    if (!phone.trim() && !email.trim()) { setError("Provide a phone number or email address."); return; }
    if (phone.trim() && !/^\d{7,15}$/.test(phone.replace(/\D/g, ""))) { setError("Enter a phone number with 7 to 15 digits."); return; }
    upsertContact({ id: `contact_${crypto.randomUUID()}`, workspaceId: workspace.workspaceId, name: name.trim(), phone: phone.trim(), email: email.trim().toLowerCase(), lastContactAt: new Date().toISOString() });
    setAdding(false); setName(""); setPhone(""); setEmail(""); setError("");
  }
  return <>
    <PageHeading eyebrow="Customer context" title="Contacts that carry the conversation forward." copy="Keep callback details and recent activity connected to the inquiry instead of scattered across tools." action={hasCapability(actor.role, "inbox:operate") ? <button className="eo-primary-button" onClick={() => setAdding(!adding)}><Plus /> {adding ? "Close contact form" : "Add contact"}</button> : undefined} />
    {adding && <section className="eo-panel eo-empty"><form className="eo-form-grid" onSubmit={addContact}><label>Contact name<input required value={name} onChange={(event) => setName(event.target.value)} /></label><label>Contact phone<input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} /></label><label>Contact email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>{error && <p role="alert">{error}</p>}<button className="eo-primary-button">Save contact</button></form></section>}
    <small role="status">{syncStatus === "saving" ? "Saving workspace changes..." : syncStatus === "error" ? "Workspace changes could not be saved. Reload to review persisted data." : ""}</small>
    <section className="eo-panel"><div className="eo-contact-grid">{workspace.contacts.map((contact) => <article key={contact.id}><span>{contact.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span><div><h3>{contact.name}</h3><p>{contact.phone}</p><small>{contact.email || "Email not provided"}</small><details><summary>Contact details</summary><p>Last contact: {formatDate(contact.lastContactAt)}</p>{contact.phone && <a href={`tel:${contact.phone.replace(/[^+\d]/g, "")}`}>Call contact</a>}{contact.email && <p><a href={`mailto:${contact.email}`}>Email contact</a></p>}</details></div></article>)}</div>{workspace.contacts.length === 0 && <p className="eo-empty">No customer contacts yet.</p>}</section>
  </>;
}

function CallsSection({ actor }: { actor: AuthActor }) {
  const { workspace } = useEverOnnWorkspace();
  return <><PageHeading eyebrow="Call history" title="Every call leaves a useful next step." copy="Review summaries, urgency, callback details, and handoff status captured by the AI front desk." action={hasCapability(actor.role, "calls:operate") ? <Link className="eo-primary-button" href="/dashboard/ai-agent"><PhoneCall /> Start a test call</Link> : undefined} /><section className="eo-panel"><div className="eo-table-wrap"><table className="eo-table"><thead><tr><th>Caller</th><th>Summary</th><th>Urgency</th><th>Outcome</th><th>Time</th></tr></thead><tbody>{workspace.conversations.filter((item) => item.channel === "phone").map((call) => <tr key={call.id}><td><strong>{call.contactName || "Unknown caller"}</strong><small>{call.contactPhone || "No number captured"}</small></td><td>{call.summary}</td><td><StatusPill tone={call.urgency === "high" ? "danger" : "neutral"}>{call.urgency}</StatusPill></td><td>{call.status === "handoff" ? "Human callback" : "Captured"}</td><td>{formatDate(call.createdAt)}</td></tr>)}</tbody></table></div></section></>;
}

function AppointmentsSection({ actor }: { actor: AuthActor }) {
  const { workspace, sampleAppointments } = useEverOnnWorkspace();
  const connected = workspace.integrations.googleCalendar === "connected";
  const canOperate = hasCapability(actor.role, "appointments:operate");
  const appointments = workspace.appointments.filter((appointment) => !isSampleAppointment(appointment));
  const samples = sampleAppointments;
  const unscheduled = workspace.leads.filter((lead) => lead.status !== "closed" && !workspace.appointments.some((appointment) => appointment.leadId === lead.id));
  return <>
    <PageHeading eyebrow="Service requests & bookings" title="Real service requests, with the customer's preferred time." copy="Review the original request, collect the service, date, and time, and confirm only after Google Calendar accepts the booking." action={hasCapability(actor.role, "business:configure") ? <Link className={connected ? "eo-secondary-button" : "eo-primary-button"} href="/dashboard/settings"><CalendarCheck /> {connected ? "Manage Google Calendar" : "Connect Google Calendar"}</Link> : undefined} />
    <div className="eo-notice"><ShieldCheck /><div><strong>Choose the customer&apos;s exact date and time</strong><p>Times use {workspace.profile.timeZone}. Busy or disconnected calendars leave the request unconfirmed and require follow-up.</p></div></div>
    <section className="eo-panel"><div className="eo-appointment-grid">
      {appointments.length === 0 && <p className="eo-empty">No appointments yet. Customer service requests appear below as they are captured.</p>}
      {[...appointments].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)).map((appointment) => {
        const lead = workspace.leads.find((item) => item.id === appointment.leadId);
        return <article key={appointment.id}>
          <div className="eo-date-block"><strong>{appointment.date.slice(8, 10)}</strong><span>{new Date(`${appointment.date}T12:00:00Z`).toLocaleDateString("en", { month: "short", timeZone: "UTC" })}</span></div>
          <div><h3>{appointment.service}</h3><p>{appointment.contactName} | {appointment.contactPhone || appointment.contactEmail || "No contact details"}</p><small>{appointment.date} at {appointment.time} | {appointment.timeZone || workspace.profile.timeZone}</small>
            {(appointment.requestDetails || lead?.reason) && <p className="eo-request-details">{appointment.requestDetails || lead?.reason}</p>}
            {lead?.automation?.message && <small>{lead.automation.message}</small>}
            {appointment.timeZone && appointment.timeZone !== workspace.profile.timeZone && <p className="eo-request-details">This event was booked using {appointment.timeZone}. The business now uses {workspace.profile.timeZone}; review the actual Calendar event before changing its time.</p>}
            {!workspace.profile.services.some((service) => service.active && service.name.toLowerCase() === appointment.service.toLowerCase()) && <p className="eo-request-details">This booked service is outside the current approved service list. Review the customer request and existing event.</p>}
            {appointment.googleEventUrl && <a className="eo-text-link" href={appointment.googleEventUrl} target="_blank" rel="noopener noreferrer">Open Google Calendar event <ExternalLink size={14} /></a>}
            {canOperate && lead && appointment.status === "requested" && <ScheduleRequest lead={lead} />}
          </div><StatusPill tone={appointment.status === "confirmed" ? "good" : appointment.status === "cancelled" ? "neutral" : "warning"}>{appointment.status}</StatusPill>
        </article>;
      })}
    </div></section>
    {samples.length > 0 && <details className="eo-panel eo-empty"><summary>Sample appointment from the original demo</summary><p>This example is separate from customer service requests and has no Calendar booking.</p>{samples.map((sample) => <p key={sample.id}>{sample.contactName} · {sample.service} · {sample.date} at {sample.time}</p>)}</details>}
    {unscheduled.length > 0 && <section className="eo-panel"><div className="eo-panel-heading"><div><span>Customer service requests</span><h2>Requests without a booking</h2></div></div><div className="eo-list">{unscheduled.map((lead) => <article key={lead.id}><span className={`eo-source eo-source-${lead.source}`}><ChannelIcon channel={lead.source} /></span><div><strong>{lead.callerName}</strong><p>{lead.reason}</p><small>{lead.callerPhone || workspace.contacts.find((contact) => contact.id === lead.contactId)?.email} | {lead.captureStatus === "collecting" ? "Collecting request details" : "No time allocated"}</small>{lead.automation?.message && <p>{lead.automation.message}</p>}{canOperate && <ScheduleRequest lead={lead} />}</div></article>)}</div></section>}
  </>;
}

function ScheduleRequest({ lead }: { lead: Lead }) {
  const { workspace, upsertLead, addAppointment } = useEverOnnWorkspace();
  const [notice, setNotice] = useState("");
  async function submit(appointmentRequest: NonNullable<Lead["appointmentRequest"]>) {
    const response = await fetch("/api/integrations/google/automation", {
      method: "POST", headers: { "Content-Type": "application/json", "x-everonn-workspace": workspace.workspaceId },
      body: JSON.stringify({ leadId: lead.id, appointmentRequest }),
    });
    const data = await response.json() as { lead?: Lead; appointment?: import("@/features/everonn/types").Appointment; error?: string };
    if (!response.ok || !data.lead) throw new Error(data.error || "The request could not be submitted.");
    upsertLead(data.lead);
    if (data.appointment) addAppointment(data.appointment);
    setNotice(data.lead.automation?.message || "Request saved for follow-up.");
  }
  return <details className="eo-schedule-request"><summary>Set the customer&apos;s preferred service, date, and time</summary><AppointmentFields profile={workspace.profile} onSubmit={submit} />{notice && <p role="status">{notice}</p>}</details>;
}

function KnowledgeSection() {
  const { workspace, updateProfile, syncStatus } = useEverOnnWorkspace();
  const profile = workspace.profile;
  function field<K extends keyof BusinessProfile>(key: K, value: BusinessProfile[K]) { updateProfile({ [key]: value } as Pick<BusinessProfile, K>); }
  function updateService(id: string, patch: Partial<BusinessProfile["services"][number]>) {
    field("services", profile.services.map((service) => service.id === id ? { ...service, ...patch } : service));
  }
  function addService() {
    field("services", [...profile.services, { id: `service_${crypto.randomUUID()}`, name: "", description: "", active: true }]);
  }
  function removeService(id: string) {
    if (profile.services.length <= 1) return;
    field("services", profile.services.filter((service) => service.id !== id));
  }
  function updateKnowledge(id: string, patch: Partial<BusinessProfile["knowledge"][number]>) {
    field("knowledge", profile.knowledge.map((item) => item.id === id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item));
  }
  function addKnowledge() {
    field("knowledge", [...profile.knowledge, { id: `knowledge_${crypto.randomUUID()}`, category: "faq", question: "", answer: "", approved: false, updatedAt: new Date().toISOString() }]);
  }
  function removeKnowledge(id: string) {
    field("knowledge", profile.knowledge.filter((item) => item.id !== id));
  }
  const saveLabel = syncStatus === "loading" ? "Loading JSON" : syncStatus === "saving" ? "Saving JSON" : syncStatus === "error" ? "JSON save failed" : "Saved to JSON";
  const saveIcon = syncStatus === "loading" || syncStatus === "saving" ? <RefreshCw className="spin" /> : syncStatus === "error" ? <CircleAlert /> : <CheckCircle2 />;
  const activeServices = profile.services.filter((item) => item.active).length;
  const approvedAnswers = profile.knowledge.filter((item) => item.approved).length;
  const readinessChecks = [
    { label: "Core business facts", ready: Boolean(profile.businessName.trim() && profile.businessType.trim() && profile.description.trim()) },
    { label: "Customer contact method", ready: Boolean(profile.phone.trim() || profile.email.trim()) },
    { label: "Location and service area", ready: Boolean(profile.location.trim() && profile.serviceArea.trim()) },
    { label: "Business hours", ready: Boolean(profile.hours.trim()) },
    { label: `${activeServices} active service${activeServices === 1 ? "" : "s"}`, ready: activeServices > 0 },
    { label: `${approvedAnswers} approved answer${approvedAnswers === 1 ? "" : "s"}`, ready: approvedAnswers > 0 },
    { label: "Safety, pricing, and handoff rules", ready: Boolean(profile.emergencyRules.trim() && profile.pricingRules.trim() && profile.policies.trim()) },
  ];
  const readiness = Math.round(readinessChecks.filter((item) => item.ready).length / readinessChecks.length * 100);
  return <>
    <PageHeading eyebrow="Approved business knowledge" title="Enter business facts once. Use them everywhere." copy="Voice and chat use saved changes immediately. Regenerate the website after changing services or knowledge so its pages, copy, and images are rebuilt." action={<span className={`eo-save-state ${syncStatus === "error" ? "is-error" : ""}`}>{saveIcon} {saveLabel}</span>} />
    <div className="eo-notice"><Sparkles /><div><strong>One source of truth</strong><p>Everything below is saved to your JSON workspace. Voice, Gemini chat, and the next website generation use this profile—not the previous default business information.</p></div></div>
    <div className="eo-knowledge-layout">
      <section className="eo-panel eo-profile-form">
        <div className="eo-panel-heading"><div><span>Business profile</span><h2>Core information</h2></div><StatusPill tone={profile.verified ? "good" : "warning"}>{profile.verified ? "Owner verified" : "Needs verification"}</StatusPill></div>
        <div className="eo-form-grid">
          <label>Business name<input value={profile.businessName} onChange={(event) => field("businessName", event.target.value)} /></label>
          <label>Business type<input value={profile.businessType} onChange={(event) => field("businessType", event.target.value)} /></label>
          <label>Industry intelligence<select value={profile.skillId || "general"} onChange={(event) => field("skillId", event.target.value as BusinessProfile["skillId"])}>{DOMAIN_SKILLS.map((skill) => <option value={skill.id} key={skill.id}>{skill.label}</option>)}</select></label>
          <label className="wide">Description<textarea rows={4} value={profile.description} onChange={(event) => field("description", event.target.value)} /></label>
          <label>Business phone<input value={profile.phone} onChange={(event) => field("phone", event.target.value)} /></label>
          <label>Follow-up email<input type="email" value={profile.email} onChange={(event) => field("email", event.target.value)} /></label>
          <label>Location<input value={profile.location} onChange={(event) => field("location", event.target.value)} /></label>
          <label>Service area<input value={profile.serviceArea} onChange={(event) => field("serviceArea", event.target.value)} /></label>
          <label className="wide">Business hours<textarea rows={2} value={profile.hours} onChange={(event) => field("hours", event.target.value)} /></label>
        </div>
      </section>
      <aside className="eo-panel eo-knowledge-score">
        <span>Knowledge readiness</span><div className="eo-score-ring"><strong>{readiness}</strong><small>%</small></div>
        <ul>{readinessChecks.map((item) => <li className={item.ready ? "" : "muted"} key={item.label}>{item.ready ? <Check /> : <CircleAlert />} {item.label}</li>)}</ul>
      </aside>
    </div>
    <section className="eo-panel eo-editor-list">
      <div className="eo-panel-heading"><div><span>Service catalogue</span><h2>Services offered</h2></div><button className="eo-secondary-button" onClick={addService}><Plus /> Add service</button></div>
      <p className="eo-editor-help">Active services become website pages and are available to voice and chat.</p>
      {profile.services.map((service, index) => <article className="eo-service-editor" key={service.id}>
        <span className="eo-editor-number">{String(index + 1).padStart(2, "0")}</span>
        <div className="eo-editor-fields">
          <label>Service name<input value={service.name} onChange={(event) => updateService(service.id, { name: event.target.value })} placeholder="Example: Emergency plumbing" /></label>
          <label className="wide">What this service includes<textarea rows={2} value={service.description} onChange={(event) => updateService(service.id, { description: event.target.value })} placeholder="Describe the approved scope and ideal customer request." /></label>
        </div>
        <label className="eo-check-field"><input type="checkbox" checked={service.active} onChange={(event) => updateService(service.id, { active: event.target.checked })} /> Active</label>
        <button className="eo-icon-danger" onClick={() => removeService(service.id)} disabled={profile.services.length <= 1} aria-label={`Remove ${service.name || "service"}`}><Trash2 /></button>
      </article>)}
    </section>
    <section className="eo-panel eo-editor-list">
      <div className="eo-panel-heading"><div><span>Shared knowledge base</span><h2>Approved answers</h2></div><button className="eo-secondary-button" onClick={addKnowledge}><Plus /> Add answer</button></div>
      <p className="eo-editor-help">Only answers marked approved are supplied to the customer-facing AI.</p>
      {profile.knowledge.map((item) => <article className="eo-knowledge-editor" key={item.id}>
        <div className="eo-editor-fields">
          <label>Category<select value={item.category} onChange={(event) => updateKnowledge(item.id, { category: event.target.value as typeof item.category })}><option value="faq">FAQ</option><option value="service">Service</option><option value="policy">Policy</option><option value="pricing">Pricing</option><option value="handoff">Handoff</option></select></label>
          <label className="eo-check-field inline"><input type="checkbox" checked={item.approved} onChange={(event) => updateKnowledge(item.id, { approved: event.target.checked })} /> Approved for AI</label>
          <label className="wide">Customer question<input value={item.question} onChange={(event) => updateKnowledge(item.id, { question: event.target.value })} placeholder="What might a customer ask?" /></label>
          <label className="wide">Approved answer<textarea rows={3} value={item.answer} onChange={(event) => updateKnowledge(item.id, { answer: event.target.value })} placeholder="Give the exact grounded answer the AI may use." /></label>
        </div>
        <button className="eo-icon-danger" onClick={() => removeKnowledge(item.id)} aria-label={`Remove ${item.question || "knowledge answer"}`}><Trash2 /></button>
      </article>)}
    </section>
    <section className="eo-panel eo-profile-form">
      <div className="eo-panel-heading"><div><span>AI behavior</span><h2>Voice, chat, pricing, and handoff rules</h2></div></div>
      <div className="eo-form-grid">
        <label>Assistant name<input value={profile.assistantName} onChange={(event) => field("assistantName", event.target.value)} /></label>
        <label>Tone<select value={profile.tone} onChange={(event) => field("tone", event.target.value as BusinessProfile["tone"])}><option value="warm">Warm</option><option value="professional">Professional</option><option value="direct">Direct</option></select></label>
        <label className="wide">Greeting<textarea rows={2} value={profile.greeting} onChange={(event) => field("greeting", event.target.value)} /></label>
        <label className="wide">Pricing rules<textarea rows={3} value={profile.pricingRules} onChange={(event) => field("pricingRules", event.target.value)} /></label>
        <label className="wide">Policies<textarea rows={3} value={profile.policies} onChange={(event) => field("policies", event.target.value)} /></label>
        <label className="wide">Emergency rules<textarea rows={3} value={profile.emergencyRules} onChange={(event) => field("emergencyRules", event.target.value)} /></label>
        <label>Human transfer number<input value={profile.transferNumber} onChange={(event) => field("transferNumber", event.target.value)} /></label>
        <label>Time zone<input value={profile.timeZone} onChange={(event) => field("timeZone", event.target.value)} /></label>
      </div>
    </section>
  </>;
}

function AiAgentSection() {
  const { workspace, addConversation, upsertContact, upsertLead, setIntegration } = useEverOnnWorkspace();
  const profile = workspace.profile;
  const [messages, setMessages] = useState<TranscriptMessage[]>([{ id: "welcome", role: "assistant", text: profile.greeting, at: new Date().toISOString() }]);
  const [input, setInput] = useState("");
  const [saved, setSaved] = useState(false);
  const [startingVoice, setStartingVoice] = useState(false);
  const [replying, setReplying] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const captureQueue = useRef<ReturnType<typeof createLeadCaptureQueue> | null>(null);
  const captureInput = useRef<LeadCaptureInput | null>(null);
  const lastCaptureSignature = useRef("");
  const usageSession = useRef<{ id?: string; conversationId?: string }>({});
  const [captureBusy, setCaptureBusy] = useState(false);
  const [captureNotice, setCaptureNotice] = useState("");
  async function finishCapture() {
    if (!captureInput.current || !captureQueue.current) return null;
    const data = await captureQueue.current({ ...captureInput.current, finalize: true });
    if (data) {
      upsertContact(data.contact);
      upsertLead(data.lead);
      setCaptureNotice(data.automationError || data.lead.automation?.message || "Customer request submitted to the team.");
    }
    return data;
  }
  const liveVoice = useConversation({
    clientTools: {
      capture_lead: async () => bookingToolResult(captureInput.current && captureQueue.current ? await captureQueue.current({ ...captureInput.current, finalize: false }) : null, "Continue collecting the customer's actual request and callback details. No appointment is confirmed."),
      prepare_appointment: async () => bookingToolResult(await finishCapture()),
      book_appointment: async () => bookingToolResult(await finishCapture()),
      request_human_handoff: async () => bookingToolResult(await finishCapture(), "The callback request was saved; no live transfer was performed."),
      check_availability: () => JSON.stringify({ available: null, message: "Collect the exact preferred date and time. The booking submission checks the calendar." }),
    },
    onConnect({ conversationId }) {
      usageSession.current.conversationId = conversationId;
      void notifyElevenLabsUsage(usageSession.current.id, conversationId);
      setIntegration("elevenLabs", "ready");
      setStartingVoice(false);
      setVoiceError("");
    },
    onDisconnect() {
      void notifyElevenLabsUsage(usageSession.current.id, usageSession.current.conversationId);
      setStartingVoice(false);
      void finishCapture().catch((cause) => setVoiceError((cause as Error).message));
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

  useEffect(() => {
    const details = extractCallerDetails(messages);
    if (!details.callerPhone && !details.callerEmail) return;
    const reason = messages.filter((item) => item.role === "caller").map((item) => item.text).join("\n");
    captureQueue.current ||= createLeadCaptureQueue({ requestId: crypto.randomUUID(), workspaceId: workspace.workspaceId });
    captureInput.current = { callerName: details.callerName || "AI caller", callerPhone: details.callerPhone, callerEmail: details.callerEmail, reason, urgency: details.urgency, source: "phone", finalize: false };
    const signature = JSON.stringify(captureInput.current);
    if (lastCaptureSignature.current === signature) return;
    lastCaptureSignature.current = signature;
    void captureQueue.current(captureInput.current).then((data) => {
      if (!data) return;
      upsertContact(data.contact);
      upsertLead(data.lead);
    }).catch((cause) => {
      setVoiceError(cause instanceof Error ? cause.message : "The customer details could not be saved. Please try again.");
    });
  }, [messages, upsertContact, upsertLead, workspace.workspaceId]);

  function speak(value: string) {
    window.speechSynthesis.cancel();
    const speech = new SpeechSynthesisUtterance(value);
    speech.rate = 0.96;
    window.speechSynthesis.speak(speech);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = input.trim();
    if (!value || replying) return;
    setSaved(false);
    setCaptureNotice("");
    const caller: TranscriptMessage = { id: crypto.randomUUID(), role: "caller", text: value, at: new Date().toISOString() };
    if (live) {
      setMessages((current) => [...current, caller]);
      liveVoice.sendUserMessage(value);
      setInput("");
      return;
    }
    setInput("");
    setMessages((current) => [...current, caller]);
    setReplying(true);
    setVoiceError("");
    try {
      const response = await fetch("/api/assistant/message", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-everonn-workspace": workspace.workspaceId },
        body: JSON.stringify({ messages: [...messages, caller].map((message) => ({ role: message.role, text: message.text })) }),
      });
      const data = await response.json() as { reply?: string; error?: string };
      if (!response.ok || !data.reply) throw new Error(data.error || "Gemini could not answer this message.");
      const assistant: TranscriptMessage = { id: crypto.randomUUID(), role: "assistant", text: data.reply, at: new Date().toISOString() };
      setMessages((current) => [...current, assistant]);
      speak(data.reply);
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : "Gemini could not answer this message.");
    } finally {
      setReplying(false);
    }
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
      const data = await response.json() as { conversationToken?: string; dynamicVariables?: Record<string, string>; usageSessionId?: string; error?: string };
      if (!response.ok || !data.conversationToken) throw new Error(data.error || "Unable to create the ElevenLabs session.");
      usageSession.current = { id: data.usageSessionId };
      await liveVoice.startSession({ conversationToken: data.conversationToken, connectionType: "webrtc", dynamicVariables: data.dynamicVariables, userId: data.usageSessionId });
    } catch (error) {
      setStartingVoice(false);
      setVoiceError(error instanceof Error ? error.message : "Microphone access or ElevenLabs setup failed.");
    }
  }

  function resetConversation() {
    if (live) liveVoice.endSession();
    if (captureInput.current) void finishCapture().catch((cause) => setVoiceError((cause as Error).message));
    captureQueue.current = null;
    captureInput.current = null;
    lastCaptureSignature.current = "";
    setMessages([{ id: crypto.randomUUID(), role: "assistant", text: profile.greeting, at: new Date().toISOString() }]);
    setSaved(false);
    setVoiceError("");
    setCaptureNotice("");
  }

  async function saveCall() {
    if (captureBusy) return;
    setCaptureBusy(true);
    try {
      await finishCapture();
    const details = extractCallerDetails(messages);
    const callerText = messages.filter((item) => item.role === "caller").map((item) => item.text).join(" ");
    const now = new Date().toISOString();
    const conversationId = `conv_${crypto.randomUUID()}`;
    addConversation({ id: conversationId, workspaceId: workspace.workspaceId, channel: "phone", status: details.urgency === "high" ? "handoff" : "completed", contactName: details.callerName, contactPhone: details.callerPhone, summary: callerText.slice(0, 300) || "Test call completed", urgency: details.urgency, messages, createdAt: now });
    setSaved(true);
    } catch (cause) {
      setVoiceError(cause instanceof Error ? cause.message : "The request could not be submitted. Try again.");
    } finally {
      setCaptureBusy(false);
    }
  }

  return <>
    <PageHeading eyebrow="AI phone front desk" title="Test the receptionist against approved facts." copy="Start a live ElevenLabs voice conversation or a Gemini-powered text conversation. Both use the approved business profile and handoff rules." />
    {voiceError && <div className="eo-error"><CircleAlert /> {voiceError}</div>}
    {captureNotice && <div className="eo-notice" role="status"><CheckCircle2 /> {captureNotice}</div>}
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
          <div><dt>AI providers</dt><dd>{workspace.integrations.elevenLabs === "ready" || live ? "ElevenLabs + Gemini" : "Gemini text"}</dd></div>
          <div><dt>Approved services</dt><dd>{profile.services.filter((item) => item.active).length}</dd></div>
          <div><dt>Knowledge answers</dt><dd>{profile.knowledge.filter((item) => item.approved).length}</dd></div>
          <div><dt>Human handoff</dt><dd>{profile.transferNumber ? "Configured" : "Callback only"}</dd></div>
        </dl>
        <Link className="eo-secondary-button" href="/dashboard/knowledge">Edit approved information</Link>
      </section>
      <section className="eo-panel eo-agent-console">
        <header>
          <div><span className="eo-live-dot" /><div><strong>{live ? "Live ElevenLabs conversation" : "Live Gemini text conversation"}</strong><small>{live ? "Microphone and speaker are active" : replying ? "Gemini is composing a grounded reply" : "Uses the approved business profile"}</small></div></div>
          <button onClick={resetConversation}><RefreshCw /> Reset</button>
        </header>
        <div className="eo-transcript">{messages.map((message) => <div className={message.role} key={message.id}><span>{message.role === "assistant" ? profile.assistantName : "Caller"}</span><p>{message.text}</p></div>)}</div>
        <form onSubmit={submit}><input value={input} onChange={(event) => setInput(event.target.value)} placeholder={live ? "Send a text message into the live call…" : "Ask Gemini using your approved business knowledge…"} disabled={replying} /><button aria-label="Send" disabled={replying || !input.trim()}>{replying ? <RefreshCw className="spin" /> : <Send />}</button></form>
        <footer><small>{live ? "Live transcript is captured for the inbox summary." : "Gemini replies are grounded by the approved profile."}</small><button className="eo-primary-button" onClick={saveCall} disabled={saved || captureBusy || replying || messages.length < 3}>{saved ? <><Check /> Saved to inbox</> : captureBusy ? "Submitting request..." : "Finish & save summary"}</button></footer>
      </section>
    </div>
  </>;
}

function WebsiteSection() {
  const { workspace, setWebsiteProject, advanceWebsiteProject, refreshWebsiteState, syncStatus } = useEverOnnWorkspace();
  const project = workspace.websiteProject;
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<WebsiteGenerationProgress | null>(null);

  async function generate() {
    setGenerating(true); setError(""); setProgress({ stage: "content", message: "Starting your website build." });
    try {
      if (syncStatus === "loading" || syncStatus === "saving" || syncStatus === "error") throw new Error("Wait for your business profile to finish saving before generating a website.");
      const response = await fetch("/api/website-studio", { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/x-ndjson", "x-everonn-workspace": workspace.workspaceId }, body: JSON.stringify({ workspaceId: workspace.workspaceId }) });
      const data = await readWebsiteGeneration(response, setProgress);
      if (!response.ok || !data.project) throw new Error(data.error || "Unable to generate the website project.");
      setWebsiteProject(data.project);
      await refreshWebsiteState();
      return true;
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "Unable to generate the website project.");
      return false;
    } finally { setGenerating(false); }
  }

  return <>
    <PageHeading eyebrow="AI Website Studio" title="A website shaped around your business." copy="Explore three distinct design compositions, request changes in your own words, and review every new version before publishing." action={<button className="eo-primary-button" onClick={generate} disabled={generating || syncStatus !== "saved"}>{generating ? <><RefreshCw className="spin" /> Generating</> : <><Sparkles /> {project ? "Regenerate concepts" : "Generate three concepts"}</>}</button>} />
    <WebsiteDesignEditor generating={generating} onGenerate={generate} />
    {generating && progress && <div className="eo-notice" role="status" aria-live="polite"><RefreshCw className="spin" /><div><strong>{progress.message}</strong><p>Your published website stays available while this private preview is built. Larger service catalogues take several minutes.</p>{progress.totalPages && <progress aria-label="Website pages complete" max={progress.totalPages} value={progress.completedPages || 0} />}</div></div>}
    <WebsiteReleaseView />
    {error && <div className="eo-error"><CircleAlert /> {error}</div>}
    {!project ? <section className="eo-panel eo-empty-studio"><div><Globe2 /></div><h2>Your private website concepts begin here.</h2><p>EverOnn will use {workspace.profile.services.filter((item) => item.active).length} active services, {workspace.profile.knowledge.filter((item) => item.approved).length} approved answers, and your saved design direction.</p><button className="eo-primary-button" onClick={generate} disabled={generating || syncStatus !== "saved"}><Sparkles /> Generate website</button></section> : <WebsiteProjectView project={project} advance={advanceWebsiteProject} />}
  </>;
}

function WebsiteReleaseView() {
  const { workspace, refreshWebsiteState, syncStatus } = useEverOnnWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const live = workspace.publishedWebsite;
  if (!live) return null;
  async function restore(releaseId: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/website-studio/status", { method: "POST", headers: { "Content-Type": "application/json", "x-everonn-workspace": workspace.workspaceId }, body: JSON.stringify({ rollbackReleaseId: releaseId, expectedLiveReleaseId: live!.id }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Unable to restore this release.");
      await refreshWebsiteState();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to restore this release."); }
    finally { setBusy(false); }
  }
  return <section className="eo-panel eo-website-releases"><div><strong>Your published website stays live while you review revisions.</strong><a href={`/sites/${live.project.publicSlug}`} target="_blank" rel="noreferrer">View live website <ExternalLink /></a></div>{workspace.websiteReleases?.length ? <details><summary>Previous published versions ({workspace.websiteReleases.length})</summary>{workspace.websiteReleases.map((release) => <div key={release.id}><span>{formatDate(release.publishedAt)} · {release.project.selectedConcept}</span><button className="eo-secondary-button" disabled={busy || syncStatus !== "saved"} onClick={() => void restore(release.id)}>Restore this version</button></div>)}</details> : null}{error && <p className="eo-error" role="alert">{error}</p>}</section>;
}

function WebsiteProjectView({ project, advance }: { project: WebsiteProject; advance: (status: WebsiteProject["status"], concept?: WebsiteProject["selectedConcept"]) => Promise<void> }) {
  const [concept, setConcept] = useState<"editorial" | "momentum" | "aura">(project.selectedConcept || "editorial");
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState("");
  const stepIndex = ["generated", "claimed", "verified", "approved", "published"].indexOf(project.status);
  const next = ["claimed", "verified", "approved", "published"][Math.max(0, stepIndex)] as WebsiteProject["status"] | undefined;
  const actionLabels: Partial<Record<WebsiteProject["status"], string>> = { generated: "Claim this preview", claimed: "Verify business owner", verified: "Approve for publishing", approved: "Publish website" };

  async function updatePublishing(status: WebsiteProject["status"]) {
    setPublishing(true);
    setPublishError("");
    try {
      await advance(status, concept);
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : "Unable to update the website publishing status.");
    } finally {
      setPublishing(false);
    }
  }

  return <>
    <section className="eo-panel eo-project-status">
      <div>
        <span>Private preview workflow</span>
        <h2>{project.spec.hero.headline}</h2>
        <p>Created {formatDate(project.createdAt)} · Home + Services + {project.spec.services.length} service pages + About + Contact</p>
        <small>{project.generation ? `Generated by Gemini · ${project.generation.model}` : "Legacy project · regenerate to use verified Gemini-only generation"}</small>
        {project.spec.design && <p>{project.spec.design.rationale}</p>}
      </div>
      <StatusPill tone={project.status === "published" ? "good" : "warning"}>{project.status}</StatusPill>
      <ol>{["Generated", "Claimed", "Owner verified", "Approved", "Published"].map((label, index) => <li className={index <= stepIndex ? "done" : ""} key={label}><i>{index < stepIndex ? <Check /> : index + 1}</i><span>{label}</span></li>)}</ol>
    </section>
    <div className="eo-studio-grid">
      <section className="eo-panel eo-concept-panel">
        <div className="eo-concept-tabs">{project.concepts.map((item) => <button className={concept === item ? "active" : ""} onClick={() => setConcept(item)} key={item}>{item}</button>)}</div>
        <iframe className="eo-generated-preview" title={`${concept} website preview`} src={`/preview/${project.privateToken}?theme=${concept}`} loading="lazy" sandbox="allow-scripts allow-same-origin allow-forms" />
        <div className="eo-concept-actions">
          <button className="eo-secondary-button" onClick={() => void updatePublishing(project.status)} disabled={publishing}><Check /> {publishing ? "Saving…" : `Select ${concept}`}</button>
          <Link className="eo-primary-button" href={`/preview/${project.privateToken}?theme=${concept}`} target="_blank">Open multi-page preview <ExternalLink /></Link>
        </div>
      </section>
      <aside className="eo-panel eo-qa-panel">
        <span>Website QA</span>
        <div className={`eo-qa-result ${project.qa.passed ? "passed" : "failed"}`}>{project.qa.passed ? <CheckCircle2 /> : <CircleAlert />}<div><strong>{project.qa.passed ? "All checks passed" : "Action required"}</strong><small>{project.qa.checks.filter((item) => item.passed).length} of {project.qa.checks.length} checks</small></div></div>
        {project.qa.checks.map((check) => <div className="eo-qa-check" key={check.key}>{check.passed ? <Check /> : <X />}<span>{check.message}</span></div>)}
        {publishError && <div className="eo-error eo-publish-error"><CircleAlert /> {publishError}</div>}
        {next && <button className="eo-primary-button eo-wide" onClick={() => void updatePublishing(next)} disabled={publishing}>{publishing ? "Saving…" : actionLabels[project.status]} {!publishing && <ChevronRight />}</button>}
        {project.status === "published" && <a className="eo-primary-button eo-wide" href={`/sites/${project.publicSlug}`} target="_blank">View published site <ExternalLink /></a>}
      </aside>
    </div>
  </>;
}

function BillingSection() {
  return <><PageHeading eyebrow="Billing" title="Billing integration pending." copy="This workspace has no connected subscription billing provider." /><section className="eo-panel eo-empty"><h2>Subscription billing is unavailable</h2><p>Invoices, plan charges, and metered usage are not available in EverOnn yet. Costs for connected AI providers are managed in their own accounts.</p></section></>;
}

const roleDescriptions = { owner: "Full workspace, team, billing, and publishing control", manager: "Configure business channels and handle customers", agent: "Operate inbox, calls, contacts, and appointments", viewer: "Read-only workspace access" } as const;

function SettingsSection({ actor }: { actor: AuthActor }) {
  const router = useRouter();
  const { workspace, setIntegration, updateTeamMember } = useEverOnnWorkspace();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<TeamMember["role"]>("agent");
  const [inviteUrl, setInviteUrl] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [passwords, setPasswords] = useState({ current: "", next: "", confirm: "" });
  const [passwordMessage, setPasswordMessage] = useState("");
  const [connections, setConnections] = useState({ loading: true, googleConfigured: false, googleConnected: false, calendarConnected: false, gmailConnected: false, googleRedirectUri: "", elevenLabsConfigured: false, error: "" });
  const canConfigure = hasCapability(actor.role, "business:configure");
  const canManageTeam = hasCapability(actor.role, "team:manage");

  useEffect(() => {
    if (!canConfigure) {
      setConnections((current) => ({ ...current, loading: false }));
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const [googleResponse, voiceResponse] = await Promise.all([
          fetch("/api/integrations/google", { headers: { "x-everonn-workspace": workspace.workspaceId }, cache: "no-store", signal: controller.signal }),
          fetch("/api/voice/session", { cache: "no-store", signal: controller.signal }),
        ]);
        const google = await googleResponse.json() as { configured?: boolean; connected?: boolean; calendar?: boolean; gmail?: boolean; redirectUri?: string; error?: string };
        const voice = await voiceResponse.json() as { configured?: boolean };
        if (!googleResponse.ok) throw new Error(google.error || "Unable to read provider status.");
        setConnections({ loading: false, googleConfigured: Boolean(google.configured), googleConnected: Boolean(google.connected), calendarConnected: Boolean(google.calendar), gmailConnected: Boolean(google.gmail), googleRedirectUri: google.redirectUri || "", elevenLabsConfigured: Boolean(voice.configured), error: "" });
      } catch (error) {
        if ((error as Error).name !== "AbortError") setConnections((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : "Unable to read provider status." }));
      }
    }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [canConfigure, workspace.workspaceId]);

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

  async function invite(event: FormEvent) {
    event.preventDefault();
    setInviteError("");
    setInviteUrl("");
    try {
      const response = await fetch("/api/auth/invitations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: inviteName, email: inviteEmail, role: inviteRole }) });
      const data = await response.json() as { member?: TeamMember; inviteUrl?: string; error?: string };
      if (!response.ok || !data.member || !data.inviteUrl) throw new Error(data.error || "Unable to create invitation.");
      updateTeamMember(data.member);
      setInviteUrl(data.inviteUrl);
      setInviteEmail("");
      setInviteName("");
    } catch (error) {
      setInviteError(error instanceof Error ? error.message : "Unable to create invitation.");
    }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setPasswordMessage("");
    if (passwords.next !== passwords.confirm) return setPasswordMessage("The new passwords do not match.");
    const response = await fetch("/api/auth/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: passwords.current, newPassword: passwords.next }) });
    const data = await response.json() as { changed?: boolean; error?: string };
    if (!response.ok) return setPasswordMessage(data.error || "Unable to change the password.");
    setPasswords({ current: "", next: "", confirm: "" });
    setPasswordMessage("Password changed. Other signed-in sessions were closed.");
  }

  return <>
    <PageHeading eyebrow="Workspace controls" title="Security, team access, and connected systems." copy={`You are signed in as ${actor.name} with the ${actor.role} role.`} />
    {connections.error && <div className="eo-error"><CircleAlert /> {connections.error}</div>}
    {canConfigure && connections.googleConfigured && !connections.googleConnected && connections.googleRedirectUri && <div className="eo-notice"><ShieldCheck /><div><strong>Google Cloud authorized redirect URI</strong><p>Add this exact URI to the OAuth web client before connecting: <code>{connections.googleRedirectUri}</code></p></div></div>}
    <div className="eo-settings-grid">
      {canConfigure && <section className="eo-panel">
        <div className="eo-panel-heading"><div><span>Connections</span><h2>Customer workflow</h2></div></div>
        <div className="eo-connection"><span><CalendarCheck /></span><div><strong>Google Calendar</strong><small>{connections.calendarConnected ? "Connected with encrypted OAuth tokens" : "Check availability and create confirmed appointments"}</small></div><button disabled={connections.loading || !connections.googleConfigured} onClick={connections.googleConnected ? disconnectGoogle : connectGoogle}>{connections.loading ? "Checking…" : !connections.googleConfigured ? "Needs setup" : connections.calendarConnected ? "Disconnect" : "Connect"}</button></div>
        <div className="eo-connection"><span><Send /></span><div><strong>Gmail</strong><small>{connections.gmailConnected ? "Connected through the same approved Google account" : "Send call summaries and urgent alerts"}</small></div><button disabled={connections.loading || !connections.googleConfigured} onClick={connections.googleConnected ? disconnectGoogle : connectGoogle}>{connections.gmailConnected ? "Disconnect" : "Connect Google"}</button></div>
        <div className="eo-connection"><span><Headphones /></span><div><strong>ElevenLabs</strong><small>{connections.elevenLabsConfigured ? "API key and agent are ready for live browser voice" : "Add the API key and Agent ID to enable live voice"}</small></div><button disabled={!connections.elevenLabsConfigured} onClick={() => router.push("/dashboard/ai-agent")}>{connections.elevenLabsConfigured ? "Open live voice" : "Needs setup"}</button></div>
      </section>}
      <section className="eo-panel"><div className="eo-panel-heading"><div><span>Role permissions</span><h2>Workspace RBAC</h2></div></div>{Object.entries(roleDescriptions).map(([role, copy]) => <div className="eo-role" key={role}><strong>{role}</strong><p>{copy}</p></div>)}</section>
    </div>
    <section className="eo-panel eo-security-panel"><div className="eo-panel-heading"><div><span>Your account</span><h2>Change password</h2></div><StatusPill tone="good">{actor.role}</StatusPill></div><form className="eo-password-form" onSubmit={changePassword}><input type="password" value={passwords.current} onChange={(event) => setPasswords((current) => ({ ...current, current: event.target.value }))} placeholder="Current password" autoComplete="current-password" required /><input type="password" value={passwords.next} onChange={(event) => setPasswords((current) => ({ ...current, next: event.target.value }))} placeholder="New strong password" autoComplete="new-password" minLength={12} required /><input type="password" value={passwords.confirm} onChange={(event) => setPasswords((current) => ({ ...current, confirm: event.target.value }))} placeholder="Confirm new password" autoComplete="new-password" minLength={12} required /><button className="eo-primary-button"><ShieldCheck /> Change password</button></form>{passwordMessage && <p className="eo-form-message">{passwordMessage}</p>}</section>
    {canManageTeam && <section className="eo-panel eo-team-panel"><div className="eo-panel-heading"><div><span>Workspace team</span><h2>Members and secure invitations</h2></div></div><div className="eo-table-wrap"><table className="eo-table"><thead><tr><th>Member</th><th>Role</th><th>Status</th><th>Access</th></tr></thead><tbody>{workspace.team.map((member) => <tr key={member.id}><td><strong>{member.name}</strong><small>{member.email}</small></td><td><select value={member.role} disabled={member.id === actor.memberId} onChange={(event) => updateTeamMember({ ...member, role: event.target.value as TeamMember["role"] })}><option value="owner" disabled={member.status === "invited"}>Owner</option><option value="manager">Manager</option><option value="agent">Agent</option><option value="viewer">Viewer</option></select></td><td><StatusPill tone={member.status === "active" ? "good" : "warning"}>{member.status}</StatusPill></td><td>{roleDescriptions[member.role]}</td></tr>)}</tbody></table></div><form className="eo-invite-form" onSubmit={invite}><input required value={inviteName} onChange={(event) => setInviteName(event.target.value)} placeholder="Teammate name" /><input type="email" required value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="teammate@business.com" /><select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as TeamMember["role"])}><option value="manager">Manager</option><option value="agent">Agent</option><option value="viewer">Viewer</option></select><button className="eo-primary-button"><Users /> Create invite</button></form>{inviteError && <div className="eo-error"><CircleAlert /> {inviteError}</div>}{inviteUrl && <div className="eo-invite-link"><strong>Secure invitation link</strong><input readOnly value={inviteUrl} onFocus={(event) => event.currentTarget.select()} /><small>Send this link privately. It expires in seven days and can be used once.</small></div>}</section>}
  </>;
}
