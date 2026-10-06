"use client";

import { Conversation } from "@elevenlabs/client";
import { Bot, CheckCircle2, LoaderCircle, MessageCircle, Mic, Phone, PhoneCall, Send, Sparkles, Volume2, X } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BusinessProfile, TranscriptMessage } from "@/features/everonn/types";
import { extractCallerDetails } from "@/features/voice-agent/engine";
import { createLeadCaptureQueue } from "@/features/voice-agent/capture-client";
import type { LeadCaptureInput } from "@/features/everonn/lead-capture";
import { AppointmentFields } from "@/components/booking/appointment-fields";
import { bookingToolResult } from "@/features/voice-agent/session-context";
import { notifyElevenLabsUsage } from "@/features/usage/client";

type Panel = "chat" | "voice" | null;
type Status = "idle" | "connecting" | "live" | "gemini" | "ended" | "error";
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
  const [captureMessage, setCaptureMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [replying, setReplying] = useState(false);
  const sessionRef = useRef<AssistantSession | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const messagesRef = useRef<AssistantMessage[]>([]);
  const captureQueueRef = useRef<ReturnType<typeof createLeadCaptureQueue> | null>(null);
  const captureInputRef = useRef<LeadCaptureInput | null>(null);

  const pushMessage = useCallback((role: AssistantMessage["role"], value: unknown) => {
    const text = clean(value, 1200);
    if (!text) return messagesRef.current;
    const current = messagesRef.current;
    if (current.at(-1)?.role === role && current.at(-1)?.text === text) return current;
    const next = [...current, { id: crypto.randomUUID(), role, text }].slice(-60);
    messagesRef.current = next;
    setMessages(next);
    return next;
  }, []);

  const captureLead = useCallback(async (details: Record<string, unknown> = {}, finalize = true, asTool = false) => {
    const previous = captureInputRef.current;
    const callerName = clean(details.caller_name || details.name, 120) || previous?.callerName || "Website visitor";
    const callerPhone = clean(details.caller_phone || details.phone, 40) || previous?.callerPhone || "";
    const callerEmail = clean(details.caller_email || details.email, 254).toLowerCase() || previous?.callerEmail || "";
    const customerText = messagesRef.current.filter((message) => message.role === "visitor").map((message) => message.text).join("\n");
    const reason = customerText || clean(details.reason || details.message, 12000) || previous?.reason || "Customer callback request";
    if (!callerPhone && !callerEmail) return "Ask for a callback number or email. Nothing has been saved yet.";
    const input: LeadCaptureInput = { callerName, callerPhone, callerEmail, reason, urgency: details.urgency === "high" || details.urgency === "low" ? details.urgency : previous?.urgency || "normal", source: details.source === "phone" ? "phone" : details.source === "chat" ? "chat" : previous?.source || "chat", finalize, appointmentRequest: previous?.appointmentRequest };
    captureInputRef.current = input;
    captureQueueRef.current ||= createLeadCaptureQueue({ requestId: crypto.randomUUID(), previewToken, publicSlug });
    try {
      const data = await captureQueueRef.current(input);
      if (!data) return "The request could not be saved.";
      setCaptured(true);
      const message = data.appointment?.status === "confirmed"
        ? `Confirmed: ${data.appointment.service}, ${data.appointment.date} at ${data.appointment.time} (${data.appointment.timeZone || profile.timeZone}).`
        : finalize ? data.automationError || data.lead.automation?.message || "Your request was submitted to the team for follow-up."
          : "Your contact details are saved. Continue with the service and preferred date and time.";
      setCaptureMessage(message);
      return asTool ? bookingToolResult(data, message) : message;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Your request could not be saved. Please try again.";
      setError(message);
      throw cause;
    }
  }, [previewToken, publicSlug, profile.timeZone]);

  const captureTranscript = useCallback((conversation: AssistantMessage[], source: "phone" | "chat") => {
    const transcript: TranscriptMessage[] = conversation.map((message) => ({
      id: message.id,
      role: message.role === "visitor" ? "caller" : "assistant",
      text: message.text,
      at: new Date().toISOString(),
    }));
    const details = extractCallerDetails(transcript);
    if (!details.callerPhone && !details.callerEmail) return;
    const reason = transcript.filter((message) => message.role === "caller").map((message) => message.text).join("\n");
    void captureLead({ caller_name: details.callerName, caller_phone: details.callerPhone, caller_email: details.callerEmail, reason, urgency: details.urgency, source }, false).catch(() => undefined);
  }, [captureLead]);

  const clientTools = useMemo(() => ({
    capture_lead: (details: Record<string, unknown>) => captureLead(details, false, true),
    prepare_appointment: (details: Record<string, unknown>) => captureLead(details, true, true),
    request_human_handoff: (details: Record<string, unknown>) => captureLead(details, true, true),
    check_availability: () => JSON.stringify({ available: null, message: "Collect the customer's exact preferred date and time. The booking submission checks the calendar; no slot is confirmed yet." }),
    book_appointment: (details: Record<string, unknown>) => captureLead(details, true, true),
  }), [captureLead]);

  const endSession = useCallback(async () => {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) await session.endSession().catch(() => undefined);
    if (captureInputRef.current) await captureLead({}, true).catch(() => undefined);
    setStatus("idle");
    setActivity("");
  }, [captureLead]);

  useEffect(() => () => { if (sessionRef.current) void sessionRef.current.endSession().catch(() => undefined); }, []);
  useEffect(() => () => {
    if (captureQueueRef.current && captureInputRef.current) void captureQueueRef.current({ ...captureInputRef.current, finalize: true }).catch(() => undefined);
  }, []);
  useEffect(() => { if (transcriptRef.current) transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight; }, [messages, activity]);

  const start = useCallback(async (mode: Exclude<Panel, null>) => {
    await endSession();
    setPanel(mode);
    setMessages([]);
    messagesRef.current = [];
    captureQueueRef.current = createLeadCaptureQueue({ requestId: crypto.randomUUID(), previewToken, publicSlug });
    captureInputRef.current = null;
    setCaptured(false);
    setCaptureMessage("");
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
        body: JSON.stringify({ ...(previewToken ? { previewToken } : { publicSlug }), mode }),
      });
      const data = await response.json() as { error?: string; conversationToken?: string; signedUrl?: string; usageSessionId?: string; dynamicVariables?: Record<string, string> };
      if (!response.ok) throw new Error(data.error || "The live AI assistant could not connect.");
      let providerConversationId: string | undefined;
      const callbacks = {
        userId: data.usageSessionId,
        dynamicVariables: data.dynamicVariables,
        clientTools,
        onConnect: ({ conversationId }: { conversationId: string }) => { providerConversationId = conversationId; void notifyElevenLabsUsage(data.usageSessionId, conversationId); },
        onMessage: ({ message, role, source }: { message: string; role: string; source?: string }) => {
          const assistant = role === "agent" || source === "ai";
          const conversation = pushMessage(assistant ? "assistant" : "visitor", message);
          if (!assistant) captureTranscript(conversation, mode === "voice" ? "phone" : "chat");
        },
        onModeChange: ({ mode: current }: { mode: string }) => setActivity(current === "listening" ? "Listening…" : current === "speaking" ? "Speaking…" : ""),
        onError: (message: string) => { setError(clean(message) || "The AI conversation was interrupted."); setStatus("error"); },
        onDisconnect: () => { void notifyElevenLabsUsage(data.usageSessionId, providerConversationId); setActivity(""); setStatus("ended"); sessionRef.current = null; if (captureInputRef.current) void captureLead({}, true).catch(() => undefined); },
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
        setStatus("gemini");
        setActivity("Ready to help");
        pushMessage("assistant", profile.greeting);
      } else {
        setError(message);
        setStatus("error");
        setActivity("");
      }
    }
  }, [captureLead, captureTranscript, clientTools, endSession, previewToken, profile.greeting, publicSlug, pushMessage]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = draft.trim();
    if (!value || replying || (status !== "live" && status !== "gemini")) return;
    setDraft("");
    const conversation = pushMessage("visitor", value);
    captureTranscript(conversation, panel === "voice" ? "phone" : "chat");
    if (status === "live" && sessionRef.current) {
      sessionRef.current.sendUserMessage(value);
      return;
    }
    setActivity(`${profile.assistantName} is thinking…`);
    setReplying(true);
    setError("");
    try {
      const response = await fetch("/api/assistant/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(previewToken ? { previewToken } : { publicSlug }),
          messages: conversation.map((message) => ({ role: message.role === "visitor" ? "caller" : "assistant", text: message.text })),
        }),
      });
      const data = await response.json() as { reply?: string; model?: string; error?: string };
      if (!response.ok || !data.reply) throw new Error(data.error || "Gemini could not answer this message.");
      pushMessage("assistant", data.reply);
      setActivity("Ready to help");
    } catch (replyError) {
      setError(replyError instanceof Error && replyError.message.startsWith("Please wait") ? replyError.message : "The assistant is temporarily unavailable. Please try again or contact the business directly.");
      setActivity("Please try again shortly");
    } finally {
      setReplying(false);
    }
  }

  async function submitRequest(appointmentRequest?: LeadCaptureInput["appointmentRequest"]) {
    setSubmitting(true);
    try {
      if (appointmentRequest && captureInputRef.current) captureInputRef.current = { ...captureInputRef.current, appointmentRequest };
      const message = await captureLead({}, true);
      pushMessage("assistant", message);
    } catch { /* The capture error is displayed in the panel. */ }
    finally { setSubmitting(false); }
  }

  const close = () => { void endSession(); setPanel(null); setError(""); };
  const connecting = status === "connecting";

  return <aside className={`client-assistant${panel ? " is-open" : ""}`} aria-label={`${profile.businessName} AI assistant`} data-ai-chat-ready="true" data-voice-agent-ready="true">
    {panel && <section className="client-assistant-panel" role="dialog" aria-label={`${profile.businessName} AI ${panel}`}><header><span className="client-assistant-avatar"><Sparkles /></span><div><small>AI assistant</small><strong>{profile.assistantName} at {profile.businessName}</strong></div><button onClick={close} aria-label="Close assistant"><X /></button></header>{panel === "chat" ? <><div className="client-assistant-status"><i className={`status-${status}`} />{activity || "Ready to help"}</div><div className="client-assistant-messages" ref={transcriptRef}>{connecting && <div className="client-assistant-connecting"><LoaderCircle className="spin" /> Connecting securely…</div>}{messages.map((message) => <p className={message.role} key={message.id}>{message.text}</p>)}{error && <div className="client-assistant-error">{error}</div>}</div>{captured && <small className="client-captured"><CheckCircle2 /> {captureMessage}</small>}<form onSubmit={submit}><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask about services, hours, or appointments" disabled={connecting || replying || submitting} aria-label="Message the AI assistant" /><button aria-label="Send message" disabled={!draft.trim() || connecting || replying || submitting}><Send /></button></form></> : <div className="client-assistant-voice"><div className={`client-voice-orb status-${status}`}><Mic /><i /><i /></div><small>{connecting ? "Connecting securely…" : activity || "Voice conversation ended"}</small><strong>{status === "live" ? `${profile.assistantName} is ready to help` : error || `Talk with ${profile.businessName}`}</strong>{status === "live" && <p>Ask about services, business hours, or request an appointment.</p>}{status === "live" ? <button onClick={() => void endSession()}><X /> End conversation</button> : !connecting && <button onClick={() => void start("voice")}>Try again</button>}</div>}{captured && <div className="client-request-controls"><button type="button" onClick={() => void submitRequest()} disabled={submitting}>{submitting ? "Submitting..." : "Send request to team"}</button><details><summary>Choose an appointment date and time</summary><AppointmentFields profile={profile} onSubmit={async (request) => {
      if (!captureInputRef.current) throw new Error("Share a callback number or email in the conversation first.");
      captureInputRef.current = { ...captureInputRef.current, appointmentRequest: request };
      const result = await captureLead({}, true);
      pushMessage("assistant", result);
    }} /></details></div>}<footer><span><Bot /> AI-powered assistance</span>{profile.phone && <a href={`tel:${profile.phone.replace(/[^+\d]/g, "")}`}><Phone /> Call business</a>}</footer></section>}
    <div className="client-assistant-actions"><button className="chat" onClick={() => panel === "chat" ? close() : void start("chat")} aria-label={`Chat with ${profile.businessName}`}><MessageCircle /><strong>Chat</strong></button><button className="voice" onClick={() => panel === "voice" ? close() : void start("voice")} aria-label={`Talk to ${profile.businessName} AI`}>{connecting && panel === "voice" ? <LoaderCircle className="spin" /> : panel === "voice" && status === "live" ? <Volume2 /> : <PhoneCall />}<strong>Talk to AI</strong></button></div>
  </aside>;
}
