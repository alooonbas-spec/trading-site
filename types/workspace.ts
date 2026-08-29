import type { WorkspaceRole } from "@/types/status";

export type Profile = {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
};

export type Workspace = {
  id: string;
  name: string;
  slug: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceMember = {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceMembership = {
  workspace: Workspace;
  role: WorkspaceRole;
};

export type SessionWorkspaceContext = {
  user: Profile;
  workspace: Workspace;
  role: WorkspaceRole;
  memberships: WorkspaceMembership[];
};
