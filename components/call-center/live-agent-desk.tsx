"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Gauge, Headphones, LayoutDashboard, Menu, ShieldCheck, Users, X, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DeskCommandType, DeskSnapshot } from "@/features/call-center/types";
import { DeskApiError, fetchSnapshot, sendDeskCommand } from "./desk-api";
import { ClientDirectory } from "./client-directory";
import { InteractionWorkspace } from "./interaction-workspace";
import { LeadConsole } from "./lead-console";
import { OfferCard } from "./offer-card";
import { QueuePanel } from "./queue-panel";
import { channelLabel, humanize, languageLabel, playOfferCue } from "./format";

type Tab = "desk" | "directory" | "wallboard" | "roster" | "quality";
type Notice = { tone: "error" | "info"; text: string } | null;

const pollMs = 1500;

const allTabs: Array<[Tab, string, LucideIcon]> = [["desk", "Desk", Headphones], ["directory", "Clients", Building2], ["wallboard", "Wall board", Gauge], ["roster", "Roster", Users], ["quality", "Quality", ShieldCheck]];
const sectionMeta: Record<Tab, { label: string; eyebrow: string; title: string; copy: string }> = {
  desk: { label: "Desk", eyebrow: "Live interactions", title: "Answer in the right client's name.", copy: "Offers ring here with the client, line, greeting and what the AI already captured. Your queue covers every client you are certified for." },
  directory: { label: "Clients", eyebrow: "Client directory", title: "Every client you can answer for.", copy: "Greetings, owner notes, authority and hours for the clients on your roster." },
  wallboard: { label: "Wall board", eyebrow: "Operations", title: "Queues, service levels and people.", copy: "Live view across clients and operators, owner approvals waiting, and a demo intake while telephony is not connected." },
  roster: { label: "Roster", eyebrow: "Client roster", title: "Who may answer for which client.", copy: "Record training, certify, and revoke access. Revocation takes effect immediately, including for open interactions." },
  quality: { label: "Quality", eyebrow: "Quality review", title: "Review handled interactions.", copy: "Score accuracy, safety, tone and outcome, and confirm each greeting used the right client's name." },
};

// The desk renders server-pushed state and holds no authoritative state
// (§16.7.1); every poll is also the heartbeat, and every command returns the
// fresh snapshot.
export function LiveAgentDesk({ session, isLead }: { session: string; isLead: boolean }) {
  const [snapshot, setSnapshot] = useState<DeskSnapshot | null>(null);
  const [tab, setTab] = useState<Tab>("desk");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [now, setNow] = useState(0);
  const [connection, setConnection] = useState<"connecting" | "ok" | "lost">("connecting");
  const [selected, setSelected] = useState<string | null>(null);
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const seenOffers = useRef(new Set<string>());
  const router = useRouter();

  const applySnapshot = useCallback((next: DeskSnapshot) => {
    for (const offer of next.offers) {
      if (!seenOffers.current.has(offer.offerId)) {
        seenOffers.current.add(offer.offerId);
        playOfferCue(offer.escalation.severity);
      }
    }
    setSnapshot(next);
    setConnection("ok");
  }, []);

  const run = useCallback(async (type: DeskCommandType, payload: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      const response = await sendDeskCommand(session, type, payload);
      applySnapshot(response.snapshot);
      setNotice(null);
      return response.result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "The command failed.";
      setNotice({ tone: "error", text: error instanceof DeskApiError && error.code === "client_mismatch" ? `Client mismatch blocked: ${message}` : message });
      return null;
    } finally {
      setBusy(false);
    }
  }, [session, applySnapshot]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    // Claim the single desk session for this window, then poll.
    sendDeskCommand(session, "session.start").then((response) => { if (!stopped) applySnapshot(response.snapshot); }).catch(() => undefined);
    const poll = async () => {
      try {
        const next = await fetchSnapshot(session);
        if (!stopped) applySnapshot(next);
      } catch (error) {
        if (!stopped) {
          setConnection("lost");
          if (error instanceof DeskApiError && error.status === 401) router.replace("/login?returnTo=/desk");
        }
      }
      if (!stopped) timer = window.setTimeout(poll, pollMs);
    };
    timer = window.setTimeout(poll, 300);
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [session, applySnapshot, router]);

  const active = snapshot?.active || [];
  const current = active.find((item) => item.handlingId === selected) || active[0] || null;

  // DSK-009: the client lock is visible in the browser tab title too.
  useEffect(() => {
    const offer = snapshot?.offers[0];
    document.title = current ? `${current.client.name} · ${channelLabel[current.channel]} — Live Agent Desk` : offer ? `Incoming: ${offer.client.name} — Live Agent Desk` : "Live Agent Desk | EverOnnAI";
  }, [current, snapshot?.offers]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select") || event.metaKey || event.ctrlKey || event.altKey) return;
      const offer = snapshot?.offers[0];
      if (event.key.toLowerCase() === "a" && offer && !busy) {
        event.preventDefault();
        void run("offer.accept", { offer_id: offer.offerId, tenant_id: offer.client.tenantId });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [snapshot?.offers, busy, run]);

  if (!snapshot) return <main className="desk-boot" role="status"><section className="eo-panel"><span className="eo-brand-mark">∞</span><p>Connecting to the Live Agent Desk…</p></section></main>;
  if (snapshot.superseded) {
    return (
      <main className="desk-boot">
        <section className="eo-panel">
          <span className="eo-brand-mark">∞</span>
          <h1>This desk is open in another window</h1>
          <p>Only one desk session per operator is allowed so no call is answered twice.</p>
          <button className="eo-primary-button" onClick={() => void run("session.start")}>Use this window instead</button>
        </section>
      </main>
    );
  }

  const operator = snapshot.operator;
  const tabs = allTabs.filter(([key]) => isLead || key === "desk" || key === "directory");
  const busyPresence = operator.presence === "on_call" || operator.presence === "wrap_up";

  const section = sectionMeta[tab];
  const showHeading = tab !== "desk" || (!current && snapshot.offers.length === 0);
  const initials = operator.displayName.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const waiting = snapshot.queue.filter((item) => item.kind !== "approval").length;

  return (
    <div className="eo-app desk-app">
      <aside className={`eo-sidebar ${mobileOpen ? "is-open" : ""}`}>
        <div className="eo-sidebar-brand">
          <Link href="/dashboard" aria-label="EverOnn dashboard"><span className="eo-brand-mark">∞</span><strong>EverOnn<span>.Ai</span></strong></Link>
          <button className="eo-sidebar-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X /></button>
        </div>
        <div className="eo-workspace-switcher">
          <span>Live Agent Desk</span>
          <strong>{operator.displayName}</strong>
          <small>{operator.role === "operator_lead" ? "Operator lead" : "Operator"} · {operator.languages.map(languageLabel).join(", ")}</small>
        </div>
        <nav aria-label="Desk navigation">
          <Link className="eo-project-workspace-link" href="/dashboard"><LayoutDashboard /><span>Business dashboard</span></Link>
          {tabs.map(([key, label, Icon]) => (
            <button key={key} className={tab === key ? "active" : ""} aria-current={tab === key ? "page" : undefined} onClick={() => { setTab(key); setMobileOpen(false); }}>
              <Icon /><span>{label}</span>{key === "desk" && waiting > 0 && <b>{waiting}</b>}
            </button>
          ))}
        </nav>
        <div className="eo-sidebar-bottom">
          <span className={`eo-live-dot desk-dot-${connection === "lost" ? "lost" : operator.shiftOpen ? operator.presence : "offline"}`} />
          <div><strong>{operator.shiftOpen ? humanize(operator.presence) : "Off shift"}</strong><small>{connection === "lost" ? "Reconnecting — calls stay on the server" : "Connected to the desk"}</small></div>
        </div>
      </aside>
      {mobileOpen && <button className="eo-sidebar-scrim" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}
      <div className="eo-main">
        <header className="eo-topbar">
          <button className="eo-mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu /></button>
          <div><span>{section.label}</span><small>{current ? `Client lock: ${current.client.name} · ${current.line.label}` : "One desk across every client you are certified for"}</small></div>
          <div className="eo-top-actions desk-top-actions">
            <div className="desk-stats" aria-label="My stats today">
              <span><b>{snapshot.stats.handledToday}</b> handled</span>
              <span><b>{snapshot.stats.avgHandleSeconds === null ? "—" : `${Math.floor(snapshot.stats.avgHandleSeconds / 60)}:${String(snapshot.stats.avgHandleSeconds % 60).padStart(2, "0")}`}</b> AHT</span>
              <span><b>{snapshot.stats.greetingCompliance === null ? "—" : `${Math.round(snapshot.stats.greetingCompliance * 100)}%`}</b> greeting</span>
              {snapshot.stats.qaAverage !== null && <span><b>{snapshot.stats.qaAverage.toFixed(1)}</b> QA</span>}
            </div>
            {operator.shiftOpen ? (
              <>
                <select aria-label="Presence" className={`desk-presence presence-${operator.presence}`} value={busyPresence ? operator.presence : operator.presence === "offline" ? "away" : operator.presence} disabled={busy || busyPresence} onChange={(event) => void run("presence.set", { status: event.target.value })}>
                  {busyPresence && <option value={operator.presence}>{humanize(operator.presence)}</option>}
                  <option value="available">Available</option><option value="away">Away</option><option value="break">Break</option>
                </select>
                <button className="eo-secondary-button desk-end-shift" disabled={busy || active.length > 0} onClick={() => void run("shift.end")}>End shift</button>
              </>
            ) : <span className="desk-presence presence-offline">Off shift</span>}
            <span className="eo-user-role">{operator.role === "operator_lead" ? "lead" : "operator"}</span>
            <span className="eo-avatar" title={operator.displayName}>{initials}</span>
          </div>
        </header>
        <main className="eo-content desk-content">
          <div className="desk-notices" aria-live="assertive">
            {notice && <p className={`desk-alert is-${notice.tone}`} role="alert">{notice.text}<button className="desk-link" onClick={() => setNotice(null)} aria-label="Dismiss">×</button></p>}
            {connection === "lost" && <p className="desk-alert is-error">Connection lost. Reconnecting — your calls stay on the server.</p>}
          </div>
          {showHeading && <div className="eo-page-heading"><div><span>{section.eyebrow}</span><h1>{section.title}</h1><p>{section.copy}</p></div></div>}
        {tab === "desk" && !operator.shiftOpen && <ShiftStart busy={busy} onStart={(checks) => run("shift.start", { checks })} onReviewClients={() => setTab("directory")} />}
        {tab === "desk" && operator.shiftOpen && (
          <>
            {snapshot.offers.map((offer) => (
              <OfferCard key={offer.offerId} offer={offer} now={now} busy={busy}
                onAccept={() => void run("offer.accept", { offer_id: offer.offerId, tenant_id: offer.client.tenantId }).then((result) => { if (result?.handling_id) setSelected(String(result.handling_id)); })}
                onDecline={(reason) => void run("offer.decline", { offer_id: offer.offerId, tenant_id: offer.client.tenantId, reason })} />
            ))}
            {active.length > 1 && (
              <div className="desk-interaction-tabs" role="tablist" aria-label="Open interactions">
                {active.map((item) => (
                  <button key={item.handlingId} role="tab" aria-selected={item.handlingId === current?.handlingId} style={{ "--client-color": item.client.brandColor } as React.CSSProperties}
                    onClick={() => { if (item.handlingId !== current?.handlingId) setPendingSwitch(item.handlingId); }}>
                    <i className="desk-chip" /> {item.client.name} · {channelLabel[item.channel]} · {humanize(item.state)}
                  </button>
                ))}
              </div>
            )}
            {pendingSwitch && (() => {
              const target = active.find((item) => item.handlingId === pendingSwitch);
              if (!target) return null;
              return (
                <div className="desk-switch" role="alertdialog" aria-label="Confirm client change" style={{ "--client-color": target.client.brandColor } as React.CSSProperties}>
                  <p>Switch client context from <b>{current?.client.name}</b> to <b>{target.client.name}</b>?</p>
                  <button className="desk-primary" onClick={() => { setSelected(target.handlingId); setPendingSwitch(null); }}>Switch to {target.client.name}</button>
                  <button className="desk-link" onClick={() => setPendingSwitch(null)}>Stay</button>
                </div>
              );
            })()}
            {current ? <InteractionWorkspace key={current.handlingId} interaction={current} now={now} busy={busy} run={run} /> : snapshot.offers.length === 0 && (
              <div className="desk-idle">
                <p>{operator.presence === "available" ? "You are available. Offers ring here with the client's name and greeting." : `You are ${humanize(operator.presence)}. Set yourself to Available to receive offers.`}</p>
                <small>Shortcuts: <kbd>A</kbd> accept · <kbd>G</kbd> greeting delivered · <kbd>H</kbd> hold · <kbd>M</kbd> mute · <kbd>T</kbd> transfer</small>
              </div>
            )}
            <QueuePanel items={snapshot.queue} now={now} busy={busy} run={run} compact={Boolean(current)} />
          </>
        )}
        {tab === "directory" && <ClientDirectory />}
        {isLead && (tab === "wallboard" || tab === "roster" || tab === "quality") && <LeadConsole now={now} busy={busy} run={run} view={tab} />}
        </main>
      </div>
    </div>
  );
}

// Shift start checks (DSK-014): microphone, network and client notices.
function ShiftStart({ busy, onStart, onReviewClients }: { busy: boolean; onStart: (checks: Record<string, boolean>) => Promise<Record<string, unknown> | null>; onReviewClients: () => void }) {
  const [microphone, setMicrophone] = useState<"untested" | "ok" | "failed">("untested");
  const [network, setNetwork] = useState<{ state: "untested" | "ok" | "slow" | "failed"; ms?: number }>({ state: "untested" });
  const [acknowledged, setAcknowledged] = useState(false);
  async function testMicrophone() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      stream.getTracks().forEach((track) => track.stop());
      setMicrophone("ok");
    } catch {
      setMicrophone("failed");
    }
  }
  async function testNetwork() {
    const started = performance.now();
    try {
      const response = await fetch("/api/call-center/directory", { cache: "no-store" });
      const ms = Math.round(performance.now() - started);
      setNetwork({ state: response.ok ? (ms < 800 ? "ok" : "slow") : "failed", ms });
    } catch {
      setNetwork({ state: "failed" });
    }
  }
  const networkOk = network.state === "ok" || network.state === "slow";
  return (
    <section className="desk-card desk-shift">
      <h2>Start your shift</h2>
      <p className="desk-muted">The desk routes calls only after these checks. Browser audio is a test of your device; live call audio arrives when the media layer is connected.</p>
      <ol>
        <li><button className="desk-ghost" onClick={() => void testMicrophone()}>Test microphone</button> <span className={`desk-check-result is-${microphone}`}>{microphone === "ok" ? "Microphone ready" : microphone === "failed" ? "Microphone blocked — the telephone fallback will be used" : "Not tested"}</span></li>
        <li><button className="desk-ghost" onClick={() => void testNetwork()}>Test network</button> <span className={`desk-check-result is-${network.state}`}>{network.state === "untested" ? "Not tested" : network.state === "failed" ? "Desk unreachable" : `${network.ms} ms round trip${network.state === "slow" ? " (slow)" : ""}`}</span></li>
        <li><label className="desk-check"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /> I reviewed today&apos;s client notices and greetings</label> <button className="desk-link" onClick={onReviewClients}>Open client directory</button></li>
      </ol>
      <button className="desk-primary" disabled={busy || !networkOk || !acknowledged} onClick={() => void onStart({ microphone: microphone === "ok", network: networkOk, noticesAcknowledged: acknowledged })}>Start shift and go available</button>
    </section>
  );
}
