import type { WorkspaceRole } from "@/features/everonn/types";

export type AuthActor = {
  userId: string;
  memberId: string;
  workspaceId: string;
  name: string;
  email: string;
  role: WorkspaceRole;
};
export type AuthUserRecord = AuthActor & {
  passwordHash: string;
  status: "active" | "disabled";
  failedLoginCount: number;
  lockedUntil?: string;
  createdAt: string;
  updatedAt: string;
};

export type AuthSessionRecord = {
  tokenHash: string;
  userId: string;
  workspaceId: string;
  createdAt: string;
  expiresAt: string;
};

export type AuthInvitationRecord = {
  tokenHash: string;
  workspaceId: string;
  memberId: string;
  name: string;
  email: string;
  role: Exclude<WorkspaceRole, "owner">;
  createdByUserId: string;
  createdAt: string;
  expiresAt: string;
};

export type AuthStore = {
  version: 1;
  users: AuthUserRecord[];
  sessions: AuthSessionRecord[];
  invitations: AuthInvitationRecord[];
};
