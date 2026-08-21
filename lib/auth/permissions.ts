import { PermissionError } from "@/lib/errors";
import type { WorkspaceRole } from "@/types/status";

const ROLE_RANK: Record<WorkspaceRole, number> = {
  VIEWER: 1,
  OPERATOR: 2,
  ADMIN: 3,
  OWNER: 4,
};

export function roleRank(role: WorkspaceRole): number {
  return ROLE_RANK[role];
}

export function canManageWorkspace(role: WorkspaceRole): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export function canManageMembers(role: WorkspaceRole): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export function canManageAccounts(role: WorkspaceRole): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export function canMutateWorkspaceData(role: WorkspaceRole): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "OPERATOR";
}

export function isReadOnlyRole(role: WorkspaceRole): boolean {
  return role === "VIEWER";
}

export function canAssignRole(actorRole: WorkspaceRole, targetRole: WorkspaceRole): boolean {
  if (targetRole === "OWNER") {
    return false;
  }

  if (actorRole === "OWNER") {
    return true;
  }

  if (actorRole === "ADMIN") {
    return targetRole === "OPERATOR" || targetRole === "VIEWER";
  }

  return false;
}

export function assertCanManageWorkspace(role: WorkspaceRole): void {
  if (!canManageWorkspace(role)) {
    throw new PermissionError("Only owners and admins can manage this workspace");
  }
}

export function assertCanMutateWorkspaceData(role: WorkspaceRole): void {
  if (!canMutateWorkspaceData(role)) {
    throw new PermissionError("This role is read-only");
  }
}

export function assertCanAssignRole(actorRole: WorkspaceRole, targetRole: WorkspaceRole): void {
  if (!canAssignRole(actorRole, targetRole)) {
    throw new PermissionError("You cannot assign this role");
  }
}
