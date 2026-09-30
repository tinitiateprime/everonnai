"use client";

import { usePathname } from "next/navigation";
import { ConversationProvider } from "@elevenlabs/react";
import { WorkspaceProvider } from "@/features/everonn/workspace-provider";
import { EverOnnChat } from "./everonn-chat";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

export function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname.startsWith("/sites") || pathname.startsWith("/preview") || pathname.startsWith("/login") || pathname.startsWith("/join")) return <>{children}</>;
  if (pathname.startsWith("/dashboard")) {
    return <WorkspaceProvider><ConversationProvider>{children}</ConversationProvider></WorkspaceProvider>;
  }

  return (
    <>
      <SiteHeader />
      {children}
      <SiteFooter />
      <EverOnnChat />
    </>
  );
}
