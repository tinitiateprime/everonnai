"use client";

import { Conversation } from "@elevenlabs/client";
import { Bot, CheckCircle2, LoaderCircle, MessageCircle, Mic, Phone, PhoneCall, Send, Sparkles, Volume2, X } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BusinessProfile, TranscriptMessage } from "@/features/everonn/types";
import { extractCallerDetails, respondToTypedCall } from "@/features/voice-agent/engine";

type Panel = "chat" | "voice" | null;
type Status = "idle" | "connecting" | "live" | "fallback" | "ended" | "error";
type AssistantMessage = { id: string; role: "assistant" | "visitor"; text: string };
type AssistantSession = { endSession: () => Promise<void>; sendUserMessage: (text: string) => void };

function clean(value: unknown, max = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function WebsiteAssistant({ profile, previewToken, publicSlug }: { profile: BusinessProfile; previewToken?: string; publicSlug?: string }) {
  const [panel, setPanel] = useState<Panel>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [activity, setActivity] = useState("");
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [captured, setCaptured] = useState(false);
  const sessionRef = useRef<AssistantSession | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  const pushMessage = useCallback((role: AssistantMessage["role"], value: unknown) => {
    const text = clean(value, 1200);
    if (!text) return;
    setMessages((current) => {
      if (current.at(-1)?.role === role && current.at(-1)?.text === text) return current;
      return [...current, { id: crypto.randomUUID(), role, text }].slice(-60);
    });
  }, []);

  const captureLead = useCallback((details: Record<string, unknown> = {}) => {
    const callerName = clean(details.caller_name || details.name, 120) || "Website visitor";
    const callerPhone = clean(details.caller_phone || details.phone, 40);
    const reason = clean(details.reason || details.message, 300) || "AI website assistant conversation";
    if (callerPhone && !captured) {
      setCaptured(true);
      void fetch("/api/site-assistant/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(previewToken ? { previewToken } : { publicSlug }), callerName, callerPhone, reason }),
      }).then((response) => {
        if (!response.ok) setCaptured(false);
      }).catch(() => setCaptured(false));
    }
    return "The visitor details are captured for a human follow-up. Do not claim a live transfer or confirmed booking.";
  }, [captured, previewToken, publicSlug]);

  const clientTools = useMemo(() => ({
    capture_lead: captureLead,
    prepare_appointment: (details: Record<string, unknown> = {}) => {
      captureLead({ ...details, reason: `Appointment request: ${clean(details.service || details.reason)}` });
      return "The appointment request is recorded but is not a confirmed booking.";
    },
    request_human_handoff: captureLead,
    check_availability: () => "Collect a preferred date and time. A person must confirm availability.",
    book_appointment: () => "Do not confirm a booking. Record an unconfirmed appointment request for the team.",
  }), [captureLead]);

  const endSession = useCallback(async () => {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) await session.endSession().catch(() => undefined);
    setStatus("idle");
    setActivity("");
  }, []);

  useEffect(() => () => { if (sessionRef.current) void sessionRef.current.endSession().catch(() => undefined); }, []);
  useEffect(() => { if (transcriptRef.current) transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight; }, [messages, activity]);

  const start = useCallback(async (mode: Exclude<Panel, null>) => {
    await endSession();
    setPanel(mode);
    setMessages([]);
    setCaptured(false);
    setError("");
    setStatus("connecting");
    setActivity("Connecting securely…");
    try {
      if (mode === "voice") {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Voice conversations are not supported by this browser.");
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        stream.getTracks().forEach((track) => track.stop());
      }
      const response = await fetch("/api/site-assistant/session", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(previewToken ? { previewToken } : { publicSlug }),
      });
      const data = await response.json() as { error?: string; conversationToken?: string; signedUrl?: string; dynamicVariables?: Record<string, string> };
      if (!response.ok) throw new Error(data.error || "The live AI assistant could not connect.");
      const callbacks = {
        dynamicVariables: data.dynamicVariables,
        clientTools,
        onMessage: ({ message, role, source }: { message: string; role: string; source?: string }) => pushMessage(role === "agent" || source === "ai" ? "assistant" : "visitor", message),
        onModeChange: ({ mode: current }: { mode: string }) => setActivity(current === "listening" ? "Listening…" : current === "speaking" ? "Speaking…" : ""),
        onError: (message: string) => { setError(clean(message) || "The AI conversation was interrupted."); setStatus("error"); },
        onDisconnect: () => { setActivity(""); setStatus("ended"); sessionRef.current = null; },
      };
      const session = mode === "voice"
        ? await Conversation.startSession({ conversationToken: data.conversationToken!, connectionType: "webrtc", ...callbacks })
        : await Conversation.startSession({ signedUrl: data.signedUrl!, connectionType: "websocket", textOnly: true, ...callbacks });
      sessionRef.current = session;
      setStatus("live");
      setActivity(mode === "voice" ? "You can speak now" : "Live AI chat");
    } catch (startError) {
      const message = startError instanceof Error ? startError.message : "The AI assistant could not connect.";
      if (mode === "chat") {
        setStatus("fallback");
        setActivity("Approved knowledge mode");
        pushMessage("assistant", `Hi—I'm ${profile.assistantName}, the website assistant for ${profile.businessName}. What can I help you with?`);
      } else {
        setError(message);
        setStatus("error");
        setActivity("");
      }
    }
  }, [clientTools, endSession, previewToken, profile.assistantName, profile.businessName, publicSlug, pushMessage]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = draft.trim();
    if (!value || (status !== "live" && status !== "fallback")) return;
    setDraft("");
    pushMessage("visitor", value);
    if (status === "live" && sessionRef.current) {
      sessionRef.current.sendUserMessage(value);
      return;
    }
    const history: TranscriptMessage[] = [...messages, { id: crypto.randomUUID(), role: "caller", text: value, at: new Date().toISOString() }]
      .map((item) => ({ id: item.id, role: item.role === "visitor" ? "caller" : "assistant", text: item.text, at: new Date().toISOString() }));
    const result = respondToTypedCall(profile, history.slice(0, -1), value);
    window.setTimeout(() => pushMessage("assistant", result.reply.replace("caller", "visitor")), 180);
    const details = extractCallerDetails(history);
    if (details.callerPhone && !captured) captureLead({ caller_name: details.callerName, caller_phone: details.callerPhone, reason: value });
  }

  const close = () => { void endSession(); setPanel(null); setError(""); };
  const connecting = status === "connecting";

  return <aside className={`client-assistant${panel ? " is-open" : ""}`} aria-label={`${profile.businessName} AI assistant`} data-ai-chat-ready="true" data-voice-agent-ready="true">
    {panel && <section className="client-assistant-panel" role="dialog" aria-label={`${profile.businessName} AI ${panel}`}><header><span className="client-assistant-avatar"><Sparkles /></span><div><small>AI assistant</small><strong>{profile.assistantName} at {profile.businessName}</strong></div><button onClick={close} aria-label="Close assistant"><X /></button></header>{panel === "chat" ? <><div className="client-assistant-status"><i className={`status-${status}`} />{activity || "Ready to help"}</div><div className="client-assistant-messages" ref={transcriptRef}>{connecting && <div className="client-assistant-connecting"><LoaderCircle className="spin" /> Connecting securely…</div>}{messages.map((message) => <p className={message.role} key={message.id}>{message.text}</p>)}{error && <div className="client-assistant-error">{error}</div>}</div>{captured && <small className="client-captured"><CheckCircle2 /> Your callback details were added to the team inbox.</small>}<form onSubmit={submit}><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask about services, hours, or appointments" disabled={connecting} aria-label="Message the AI assistant" /><button aria-label="Send message" disabled={!draft.trim() || connecting}><Send /></button></form></> : <div className="client-assistant-voice"><div className={`client-voice-orb status-${status}`}><Mic /><i /><i /></div><small>{connecting ? "Connecting securely…" : activity || "Voice conversation ended"}</small><strong>{status === "live" ? `${profile.assistantName} is ready to help` : error || `Talk with ${profile.businessName}`}</strong>{status === "live" && <p>Ask about services, business hours, or request an appointment.</p>}{status === "live" ? <button onClick={() => void endSession()}><X /> End conversation</button> : !connecting && <button onClick={() => void start("voice")}>Try again</button>}</div>}<footer><span><Bot /> AI-powered assistance</span>{profile.phone && <a href={`tel:${profile.phone.replace(/[^+\d]/g, "")}`}><Phone /> Call business</a>}</footer></section>}
    <div className="client-assistant-actions"><button className="chat" onClick={() => panel === "chat" ? close() : void start("chat")} aria-label={`Chat with ${profile.businessName}`}><MessageCircle /><strong>Chat</strong></button><button className="voice" onClick={() => panel === "voice" ? close() : void start("voice")} aria-label={`Talk to ${profile.businessName} AI`}>{connecting && panel === "voice" ? <LoaderCircle className="spin" /> : panel === "voice" && status === "live" ? <Volume2 /> : <PhoneCall />}<strong>Talk to AI</strong></button></div>
  </aside>;
}
