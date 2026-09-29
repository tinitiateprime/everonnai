"use client";

import Link from "next/link";
import { MessageCircle, Send, X } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";

type Message = { role: "assistant" | "visitor"; text: string };

function responseFor(question: string) {
  const value = question.toLowerCase();
  if (value.includes("price") || value.includes("cost")) {
    return "Plans start at $19/month to publish and connect your website. Front Desk is $79/month and adds AI phone answering and website chat.";
  }
  if (value.includes("free") || value.includes("preview")) {
    return "Your custom website preview is free and private. You pay $19/month only if you approve it and want it published with your domain.";
  }
  if (value.includes("phone") || value.includes("call")) {
    return "Front Desk can answer common calls, capture the reason, and transfer or summarize the conversation using rules your business approves.";
  }
  if (value.includes("industry") || value.includes("locksmith") || value.includes("tow")) {
    return "EverOnn has starting configurations for locksmiths, roadside and towing, HVAC, plumbing, garage-door, and cleaning companies—and can support other small businesses too.";
  }
  return "EverOnn combines a business website, AI phone response, website chat, booking requests, and follow-up. I can explain pricing, the free preview, phone answering, or supported industries.";
}

export function EverOnnChat() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", text: "Hi—I’m the EverOnn product preview. What would you like to know?" },
  ]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = question.trim();
    if (!value) return;
    setMessages((current) => [
      ...current,
      { role: "visitor", text: value },
      { role: "assistant", text: responseFor(value) },
    ]);
    setQuestion("");
  }

  return (
    <aside className={`chat-widget ${open ? "open" : ""}`} aria-label="EverOnn website assistant">
      {open && (
        <div className="chat-panel">
          <header>
            <div>
              <strong>EverOnn Assistant</strong>
              <span><i /> Interactive product preview</span>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close chat"><X /></button>
          </header>
          <div className="chat-messages" aria-live="polite" ref={scrollRef}>
            {messages.map((message, index) => (
              <p className={message.role} key={`${message.role}-${index}`}>{message.text}</p>
            ))}
          </div>
          <div className="chat-next">
            <Link href="/get-started">Get my free website preview</Link>
            <Link href="/demo">Book a live demo</Link>
          </div>
          <form onSubmit={submit}>
            <label className="sr-only" htmlFor="chat-question">Ask EverOnn a question</label>
            <input
              id="chat-question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask about pricing or features"
              autoFocus
            />
            <button aria-label="Send question"><Send /></button>
          </form>
          <small>Demonstration assistant—not a production customer agent.</small>
        </div>
      )}
      <button
        className="chat-launcher"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={open ? "Close EverOnn assistant" : "Ask EverOnn"}
      >
        {open ? <X /> : <MessageCircle />}
        <span>{open ? "Close" : "Ask EverOnn"}</span>
      </button>
    </aside>
  );
}
