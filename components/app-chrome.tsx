"use client";

import { usePathname } from "next/navigation";
import { WorkspaceProvider } from "@/features/everonn/workspace-provider";
import { EverOnnChat } from "./everonn-chat";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

export function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isProductApp = pathname.startsWith("/dashboard") || pathname.startsWith("/preview") || pathname.startsWith("/login");

  return (
    <WorkspaceProvider>
      {!isProductApp && <SiteHeader />}
      {children}
      {!isProductApp && <SiteFooter />}
      {!isProductApp && <EverOnnChat />}
    </WorkspaceProvider>
  );
}
