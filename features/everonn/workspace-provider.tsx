"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { createDemoWorkspace } from "./demo-data";
import type {
  Appointment,
  BusinessProfile,
  Contact,
  Conversation,
  EverOnnWorkspace,
  IntegrationState,
  Lead,
  TeamMember,
  WebsiteProject,
} from "./types";

export type WorkspaceSyncStatus = "loading" | "saving" | "saved" | "error";

type WorkspaceContextValue = {
  workspace: EverOnnWorkspace;
  hydrated: boolean;
  syncStatus: WorkspaceSyncStatus;
  updateProfile: (patch: Partial<BusinessProfile>) => void;
  setWebsiteProject: (project: WebsiteProject | null) => void;
  advanceWebsiteProject: (status: WebsiteProject["status"], selectedConcept?: WebsiteProject["selectedConcept"]) => Promise<void>;
  addConversation: (conversation: Conversation) => void;
  addLead: (lead: Lead) => void;
  upsertLead: (lead: Lead) => void;
  upsertContact: (contact: Contact) => void;
  addAppointment: (appointment: Appointment) => void;
  setIntegration: (key: keyof IntegrationState, value: IntegrationState[keyof IntegrationState]) => void;
  updateTeamMember: (member: TeamMember) => void;
  resetDemo: () => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [workspace, setWorkspace] = useState<EverOnnWorkspace>(() => createDemoWorkspace());
  const [hydrated, setHydrated] = useState(false);
  const [persistenceReady, setPersistenceReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState<WorkspaceSyncStatus>("loading");

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/workspace", { cache: "no-store", signal: controller.signal });
        const data = await response.json() as { workspace?: EverOnnWorkspace; error?: string };
        if (!response.ok || !data.workspace) throw new Error(data.error || "Unable to load the workspace JSON file.");
        setWorkspace(data.workspace);
        setPersistenceReady(true);
        setSyncStatus("saved");
      } catch (error) {
        if ((error as Error).name !== "AbortError") setSyncStatus("error");
      } finally {
        if (!controller.signal.aborted) setHydrated(true);
      }
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!hydrated || !persistenceReady) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSyncStatus("saving");
      try {
        const response = await fetch("/api/workspace", {
          method: "PUT",
          headers: { "Content-Type": "application/json", "x-everonn-workspace": workspace.workspaceId },
          body: JSON.stringify({ workspace }),
          signal: controller.signal,
        });
        const data = await response.json() as { error?: string };
        if (!response.ok) throw new Error(data.error || "Unable to save the workspace JSON file.");
        setSyncStatus("saved");
      } catch (error) {
        if ((error as Error).name !== "AbortError") setSyncStatus("error");
      }
    }, 450);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [hydrated, persistenceReady, workspace]);

  useEffect(() => {
    if (!hydrated || !persistenceReady) return;
    const controller = new AbortController();
    async function refresh() {
      if (document.visibilityState === "hidden" || syncStatus === "saving") return;
      try {
        const response = await fetch("/api/workspace", { cache: "no-store", signal: controller.signal });
        const data = await response.json() as { workspace?: EverOnnWorkspace };
        if (response.ok && data.workspace) setWorkspace(data.workspace);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setSyncStatus("error");
      }
    }
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    const interval = window.setInterval(refresh, 15_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [hydrated, persistenceReady, syncStatus]);

  const value = useMemo<WorkspaceContextValue>(() => ({
    workspace,
    hydrated,
    syncStatus,
    updateProfile(patch) {
      setWorkspace((current) => ({
        ...current,
        profile: { ...current.profile, ...patch, workspaceId: current.workspaceId, updatedAt: new Date().toISOString() },
      }));
    },
    setWebsiteProject(project) {
      setWorkspace((current) => ({ ...current, websiteProject: project }));
    },
    async advanceWebsiteProject(status, selectedConcept) {
      const project = workspace.websiteProject;
      if (!project) return;
      setSyncStatus("saving");
      try {
        const response = await fetch("/api/website-studio/status", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-everonn-workspace": workspace.workspaceId },
          body: JSON.stringify({ privateToken: project.privateToken, status, selectedConcept }),
        });
        const data = await response.json() as { project?: WebsiteProject; error?: string };
        if (!response.ok || !data.project) throw new Error(data.error || "Unable to update the website project.");
        setWorkspace((current) => ({ ...current, websiteProject: data.project! }));
        setSyncStatus("saved");
      } catch (error) {
        setSyncStatus("error");
        throw error;
      }
    },
    addConversation(conversation) {
      setWorkspace((current) => ({ ...current, conversations: [conversation, ...current.conversations] }));
    },
    addLead(lead) {
      setWorkspace((current) => ({ ...current, leads: [lead, ...current.leads] }));
    },
    upsertLead(lead) {
      setWorkspace((current) => ({
        ...current,
        leads: current.leads.some((item) => item.id === lead.id)
          ? current.leads.map((item) => item.id === lead.id ? lead : item)
          : [lead, ...current.leads],
      }));
    },
    upsertContact(contact) {
      setWorkspace((current) => ({
        ...current,
        contacts: current.contacts.some((item) => item.id === contact.id)
          ? current.contacts.map((item) => item.id === contact.id ? contact : item)
          : [contact, ...current.contacts],
      }));
    },
    addAppointment(appointment) {
      setWorkspace((current) => ({ ...current, appointments: [appointment, ...current.appointments] }));
    },
    setIntegration(key, next) {
      setWorkspace((current) => ({ ...current, integrations: { ...current.integrations, [key]: next } }));
    },
    updateTeamMember(member) {
      setWorkspace((current) => ({
        ...current,
        team: current.team.some((item) => item.id === member.id)
          ? current.team.map((item) => item.id === member.id ? member : item)
          : [...current.team, member],
      }));
    },
    resetDemo() {
      setWorkspace(createDemoWorkspace());
    },
  }), [hydrated, syncStatus, workspace]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useEverOnnWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useEverOnnWorkspace must be used within WorkspaceProvider.");
  return value;
}
