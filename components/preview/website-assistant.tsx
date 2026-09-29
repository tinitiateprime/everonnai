"use client";

import { MessageCircle, Send, X } from "lucide-react";
import { FormEvent, useState } from "react";
import { useEverOnnWorkspace } from "@/features/everonn/workspace-provider";
import type { BusinessProfile, TranscriptMessage } from "@/features/everonn/types";
import { extractCallerDetails, respondToTypedCall } from "@/features/voice-agent/engine";

export function WebsiteAssistant({ profile }: { profile: BusinessProfile }) {
  const { workspace, addLead } = useEverOnnWorkspace();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [captured, setCaptured] = useState(false);
  const [messages, setMessages] = useState<TranscriptMessage[]>([
    { id: "assistant_welcome", role: "assistant", text: `Hi—I'm ${profile.assistantName}, the website assistant for ${profile.businessName}. What can I help you with?`, at: new Date().toISOString() },
  ]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = input.trim();
    if (!value) return;
    const caller: TranscriptMessage = { id: crypto.randomUUID(), role: "caller", text: value, at: new Date().toISOString() };
    const history = [...messages, caller];
    const result = respondToTypedCall(profile, messages, value);
    const details = extractCallerDetails(history);
    const assistant: TranscriptMessage = { id: crypto.randomUUID(), role: "assistant", text: result.reply.replace("caller", "visitor"), at: new Date().toISOString() };
    setMessages([...history, assistant]);
    setInput("");
    if (!captured && details.callerPhone) {
      addLead({ id: `lead_${crypto.randomUUID()}`, workspaceId: workspace.workspaceId, callerName: details.callerName || "Website visitor", callerPhone: details.callerPhone, reason: history.filter((item) => item.role === "caller").map((item) => item.text).join(" ").slice(0, 180), source: "chat", urgency: details.urgency, status: "new", createdAt: new Date().toISOString() });
      setCaptured(true);
    }
  }

  return <aside className="client-assistant" aria-label={`${profile.businessName} website assistant`}>{open && <div className="client-assistant-panel"><header><div><strong>{profile.assistantName}</strong><span><i /> Website assistant</span></div><button onClick={() => setOpen(false)} aria-label="Close assistant"><X /></button></header><div className="client-assistant-messages">{messages.map((message) => <p className={message.role} key={message.id}>{message.text}</p>)}</div>{captured && <small className="client-captured">✓ Your callback details were added to the team inbox.</small>}<form onSubmit={submit}><input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask about services or hours" /><button aria-label="Send message"><Send /></button></form><small>Answers use approved business information. A person confirms prices and availability.</small></div>}<button className="client-assistant-launcher" onClick={() => setOpen((value) => !value)} aria-expanded={open}>{open ? <X /> : <MessageCircle />}<span>{open ? "Close" : "Ask us"}</span></button></aside>;
}
