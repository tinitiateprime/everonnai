"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Bot,
  Loader2,
  MessageCircle,
  Mic,
  MicOff,
  PhoneOff,
  Send,
  X,
} from "lucide-react";
import type { Conversation } from "@elevenlabs/client";
import "./website-assistant.css";
import { assistantConnectionError } from "@/lib/assistant-errors";

type Mode = "chat" | "voice";
type Phase = "idle" | "connecting" | "live" | "fallback" | "error" | "ended";
type Message = { id: string; role: "assistant" | "visitor"; text: string };
type SessionResponse = {
  error?: string;
  conversationToken?: string;
  signedUrl?: string;
  dynamicVariables?: Record<string, string>;
  greeting?: string;
  fallbackReady?: boolean;
};
const unavailable = () =>
  JSON.stringify({
    saved: false,
    booked: false,
    available: null,
    message:
      "Callbacks, appointments, email delivery and transfers are not connected on this website. Nothing has been submitted or confirmed. Offer the supplied business contact details.",
  });

export function WebsiteAssistant({
  business,
  version,
  revision,
  businessName,
}: {
  business: string;
  version: string;
  revision: string;
  businessName: string;
}) {
  const [mode, setMode] = useState<Mode | null>(null),
    [phase, setPhase] = useState<Phase>("idle"),
    [activity, setActivity] = useState("");
  const [messages, setMessages] = useState<Message[]>([]),
    [draft, setDraft] = useState(""),
    [error, setError] = useState(""),
    [replying, setReplying] = useState(false),
    [muted, setMuted] = useState(false);
  const session = useRef<Conversation | null>(null),
    operation = useRef<AbortController | null>(null),
    epoch = useRef(0),
    selection = useRef(0),
    history = useRef<Message[]>([]),
    transcript = useRef<HTMLDivElement | null>(null);
  const identity = { business, version, revision };
  const addMessage = useCallback((role: Message["role"], value: string) => {
    const text = value.trim().slice(0, 3000);
    if (!text) return;
    if (
      history.current.at(-1)?.role === role &&
      history.current.at(-1)?.text === text
    )
      return;
    const next = [
      ...history.current,
      {
        id:
          globalThis.crypto.randomUUID?.() ??
          `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        role,
        text,
      },
    ].slice(-40);
    history.current = next;
    setMessages(next);
  }, []);
  useEffect(() => {
    window.parent.postMessage(
      { type: "everonn-assistant-size", open: Boolean(mode) },
      window.location.origin,
    );
  }, [mode]);
  useEffect(() => {
    transcript.current?.scrollTo({ top: transcript.current.scrollHeight });
  }, [messages, activity]);
  useEffect(
    () => () => {
      epoch.current++;
      operation.current?.abort();
      const active = session.current;
      session.current = null;
      if (active) void active.endSession().catch(() => {});
    },
    [],
  );

  async function end() {
    epoch.current++;
    operation.current?.abort();
    operation.current = null;
    const active = session.current;
    session.current = null;
    if (active) await active.endSession().catch(() => {});
    setMuted(false);
    setReplying(false);
    setActivity("");
    setPhase("ended");
  }
  async function start(nextMode: Mode) {
    const intent = ++selection.current;
    await end();
    if (intent !== selection.current) return;
    const run = ++epoch.current;
    const controller = new AbortController();
    operation.current = controller;
    setMode(nextMode);
    setPhase("connecting");
    setActivity("Connecting…");
    setError("");
    setMessages([]);
    history.current = [];
    let data: SessionResponse | undefined;
    try {
      if (nextMode === "voice") {
        if (!navigator.mediaDevices?.getUserMedia)
          throw new Error(
            "Voice needs a supported browser on HTTPS or localhost.",
          );
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        stream.getTracks().forEach((track) => track.stop());
      }
      controller.signal.throwIfAborted();
      const response = await fetch("/api/site-assistant/session", {
        method: "POST",
        referrerPolicy: "strict-origin-when-cross-origin",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify({ ...identity, mode: nextMode }),
      });
      data = await response.json();
      if (!response.ok)
        throw new Error(data?.error || "The assistant could not connect.");
      const { Conversation } = await import("@elevenlabs/client");
      controller.signal.throwIfAborted();
      const callbacks = {
        dynamicVariables: data?.dynamicVariables,
        clientTools: {
          capture_lead: unavailable,
          prepare_appointment: unavailable,
          check_availability: unavailable,
          book_appointment: unavailable,
          request_human_handoff: unavailable,
        },
        onMessage: ({
          message,
          role,
          source,
        }: {
          message: string;
          role: string;
          source?: string;
        }) => {
          if (run !== epoch.current) return;
          addMessage(
            role === "agent" || source === "ai" ? "assistant" : "visitor",
            message,
          );
        },
        onModeChange: ({ mode: current }: { mode: string }) => {
          if (run === epoch.current)
            setActivity(
              current === "speaking"
                ? "Speaking…"
                : current === "listening"
                  ? "Listening…"
                  : "Connected",
            );
        },
        onError: (message: string) => {
          if (run !== epoch.current) return;
          epoch.current++;
          operation.current?.abort();
          const active = session.current;
          session.current = null;
          if (active) void active.endSession().catch(() => {});
          if (nextMode === "chat" && data?.fallbackReady) {
            setPhase("fallback");
            setActivity("Chat ready");
            setError(
              "Live chat was interrupted. Text chat is ready; please send your question again.",
            );
            if (!history.current.length)
              addMessage(
                "assistant",
                data.greeting || `Hi, how can I help you with ${businessName}?`,
              );
            return;
          }
          setError(
            assistantConnectionError(
              message || "The conversation was interrupted. Please reconnect.",
              nextMode,
            ),
          );
          setPhase("error");
        },
        onDisconnect: () => {
          if (run !== epoch.current) return;
          session.current = null;
          setActivity("Conversation ended");
          setPhase("ended");
        },
      };
      const connection =
        nextMode === "voice"
          ? await Conversation.startSession({
              conversationToken: data!.conversationToken!,
              connectionType: "webrtc",
              textOnly: false,
              ...callbacks,
            })
          : await Conversation.startSession({
              signedUrl: data!.signedUrl!,
              connectionType: "websocket",
              textOnly: true,
              ...callbacks,
            });
      if (run !== epoch.current || controller.signal.aborted) {
        await connection.endSession();
        return;
      }
      session.current = connection;
      setPhase("live");
      setActivity(
        nextMode === "voice" ? "You can speak now" : "Chat connected",
      );
    } catch (cause) {
      if (run !== epoch.current || controller.signal.aborted) return;
      if (nextMode === "chat" && data?.fallbackReady) {
        setPhase("fallback");
        setActivity("Chat ready");
        addMessage(
          "assistant",
          data.greeting || `Hi, how can I help you with ${businessName}?`,
        );
      } else {
        setPhase("error");
        setActivity("");
        setError(assistantConnectionError(cause, nextMode));
      }
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || replying || !["live", "fallback"].includes(phase)) return;
    setDraft("");
    setError("");
    addMessage("visitor", text);
    if (phase === "live" && session.current) {
      session.current.sendUserMessage(text);
      return;
    }
    const run = epoch.current;
    const controller = new AbortController();
    operation.current = controller;
    setReplying(true);
    setActivity("Thinking…");
    try {
      const response = await fetch("/api/site-assistant/message", {
        method: "POST",
        referrerPolicy: "strict-origin-when-cross-origin",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify({
          ...identity,
          messages: history.current
            .slice(-16)
            .map(({ role, text }) => ({ role, text })),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.reply)
        throw new Error(
          data.error || "The assistant could not answer. Please try again.",
        );
      if (run === epoch.current) {
        addMessage("assistant", data.reply);
        setActivity("Chat ready");
      }
    } catch (cause) {
      if (run === epoch.current && !controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "Please try again.");
        setActivity("Please try again");
      }
    } finally {
      if (run === epoch.current) setReplying(false);
    }
  }
  async function close() {
    selection.current++;
    setMode(null);
    await end();
  }
  return (
    <div className="assistant-frame">
      {mode && (
        <section
          className="agent-panel"
          role="dialog"
          aria-label="Business assistant"
          data-status={phase}
        >
          <header>
            <span className="agent-avatar">
              <Bot size={21} />
            </span>
            <div>
              <h1>Website assistant</h1>
              <p>{businessName}</p>
            </div>
            <button aria-label="Close assistant" onClick={() => void close()}>
              <X size={18} />
            </button>
          </header>
          <div className="agent-tabs">
            <button
              aria-pressed={mode === "chat"}
              onClick={() => void start("chat")}
            >
              <MessageCircle size={14} />
              Chat
            </button>
            <button
              aria-pressed={mode === "voice"}
              onClick={() => void start("voice")}
            >
              <Mic size={14} />
              Voice
            </button>
          </div>
          <div className="agent-status" role="status">
            {phase === "connecting" ? (
              <Loader2 size={13} className="agent-spin" />
            ) : (
              <span
                className={
                  phase === "live" || phase === "fallback" ? "connected" : ""
                }
              />
            )}
            <span>{activity || "Ask about our business and services"}</span>
          </div>
          {mode === "voice" && (
            <div className={`agent-voice ${phase === "live" ? "active" : ""}`}>
              <Mic size={27} />
              <p>
                {phase === "live"
                  ? muted
                    ? "Microphone muted"
                    : "Speak naturally. We’re listening."
                  : phase === "connecting"
                    ? "Preparing your voice conversation…"
                    : "Start a voice conversation to ask your questions."}
              </p>
              {phase === "live" && (
                <div>
                  <button
                    onClick={() => {
                      const next = !muted;
                      session.current?.setMicMuted(next);
                      setMuted(next);
                    }}
                  >
                    {muted ? <Mic size={14} /> : <MicOff size={14} />}{" "}
                    {muted ? "Unmute" : "Mute"}
                  </button>
                  <button onClick={() => void end()}>
                    <PhoneOff size={14} />
                    End conversation
                  </button>
                </div>
              )}
            </div>
          )}
          <div
            className="agent-transcript"
            role="log"
            aria-live="polite"
            ref={transcript}
          >
            {messages.map((message) => (
              <div key={message.id} className={`agent-message ${message.role}`}>
                <small>
                  {message.role === "assistant" ? "Assistant" : "You"}
                </small>
                <p>{message.text}</p>
              </div>
            ))}
            {!messages.length && phase !== "connecting" && (
              <div className="agent-empty">
                <Bot size={25} />
                <p>
                  Ask about services, business hours, or how to get in touch.
                </p>
              </div>
            )}
          </div>
          {error && (
            <div className="agent-error" role="alert">
              {error}
            </div>
          )}
          {(phase === "error" || phase === "ended") && (
            <button className="agent-retry" onClick={() => void start(mode)}>
              Reconnect {mode === "voice" ? "voice" : "chat"}
            </button>
          )}
          <form onSubmit={(event) => void submit(event)}>
            <label className="agent-sr-only" htmlFor="agent-message">
              Your message
            </label>
            <input
              id="agent-message"
              maxLength={2000}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={
                phase === "connecting" ? "Connecting…" : "Type your message…"
              }
              disabled={replying || !["live", "fallback"].includes(phase)}
            />
            <button
              type="submit"
              aria-label="Send message"
              disabled={
                !draft.trim() ||
                replying ||
                !["live", "fallback"].includes(phase)
              }
            >
              {replying ? (
                <Loader2 size={17} className="agent-spin" />
              ) : (
                <Send size={17} />
              )}
            </button>
          </form>
          <footer>AI assistant</footer>
        </section>
      )}
      <div className="agent-launchers">
        <button onClick={() => void start("chat")} aria-label="Chat with us">
          <MessageCircle size={17} />
          Chat with us
        </button>
        <button onClick={() => void start("voice")} aria-label="Talk to us">
          <Mic size={17} />
          Talk to us
        </button>
      </div>
    </div>
  );
}
