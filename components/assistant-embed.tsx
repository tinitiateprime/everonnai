"use client";
import { useEffect, useRef, useState } from "react";
export function AssistantEmbed({
  path,
  revision,
}: {
  path: string;
  revision: string;
}) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.origin === window.location.origin &&
        event.source === frame.current?.contentWindow &&
        event.data?.type === "everonn-assistant-size"
      )
        setOpen(event.data.open === true);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  const match = path.match(/^\/service\/([^/]+)\/([123])$/);
  if (!match) return null;
  return (
    <iframe
      ref={frame}
      className="assistant-host"
      title="Business voice and chat assistant"
      src={`/assistant/${match[1]}/${match[2]}?revision=${encodeURIComponent(revision)}`}
      allow="microphone; autoplay"
      sandbox="allow-scripts allow-same-origin allow-forms"
      referrerPolicy="strict-origin-when-cross-origin"
      style={{
        position: "absolute",
        right: 12,
        bottom: 12,
        zIndex: 30,
        width: open ? 420 : 244,
        maxWidth: "calc(100% - 24px)",
        height: open ? 620 : 76,
        maxHeight: "calc(100% - 24px)",
        border: 0,
        background: "transparent",
        borderRadius: 0,
      }}
    />
  );
}
