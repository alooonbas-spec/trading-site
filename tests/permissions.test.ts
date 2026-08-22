import { describe, expect, it } from "vitest";
import {
  assertCanAssignRole,
  assertCanManageWorkspace,
  assertCanMutateWorkspaceData,
  canAssignRole,
  canManageAccounts,
  canManageMembers,
  canManageWorkspace,
  canMutateWorkspaceData,
  isReadOnlyRole,
  roleRank,
} from "@/lib/auth/permissions";
import { PermissionError } from "@/lib/errors";
import { WORKSPACE_ROLES } from "@/types/status";

describe("workspace permissions", () => {
  it("maps roles to the specified access model", () => {
    expect(canManageMembers("OWNER")).toBe(true);
    expect(canManageMembers("ADMIN")).toBe(true);
    expect(canManageMembers("OPERATOR")).toBe(false);
    expect(canManageMembers("VIEWER")).toBe(false);
    expect(canManageAccounts("OWNER")).toBe(true);
    expect(canManageAccounts("ADMIN")).toBe(true);
    expect(canManageAccounts("OPERATOR")).toBe(false);
    expect(canManageAccounts("VIEWER")).toBe(false);
    expect(canManageWorkspace("OWNER")).toBe(true);
    expect(canManageWorkspace("ADMIN")).toBe(true);
    expect(canManageWorkspace("OPERATOR")).toBe(false);
    expect(canManageWorkspace("VIEWER")).toBe(false);
    expect(canMutateWorkspaceData("OWNER")).toBe(true);
    expect(canMutateWorkspaceData("ADMIN")).toBe(true);
    expect(canMutateWorkspaceData("OPERATOR")).toBe(true);
    expect(canMutateWorkspaceData("VIEWER")).toBe(false);
    expect(isReadOnlyRole("VIEWER")).toBe(true);
    expect(isReadOnlyRole("OPERATOR")).toBe(false);
  });

  it("ranks roles strictly OWNER > ADMIN > OPERATOR > VIEWER", () => {
    expect(roleRank("OWNER")).toBeGreaterThan(roleRank("ADMIN"));
    expect(roleRank("ADMIN")).toBeGreaterThan(roleRank("OPERATOR"));
    expect(roleRank("OPERATOR")).toBeGreaterThan(roleRank("VIEWER"));
    expect(new Set(WORKSPACE_ROLES.map(roleRank)).size).toBe(WORKSPACE_ROLES.length);
  });

  it("prevents assigning owner through invite/role change", () => {
    expect(canAssignRole("OWNER", "OWNER")).toBe(false);
    expect(canAssignRole("OWNER", "ADMIN")).toBe(true);
    expect(canAssignRole("ADMIN", "ADMIN")).toBe(false);
    expect(canAssignRole("ADMIN", "OPERATOR")).toBe(true);
    expect(canAssignRole("OPERATOR", "VIEWER")).toBe(false);
  });

  it("throws a permission error for illegal assignments", () => {
    expect(() => assertCanAssignRole("ADMIN", "ADMIN")).toThrow(PermissionError);
    expect(() => assertCanAssignRole("OWNER", "ADMIN")).not.toThrow();
  });

  it("throws for a non-owner/admin managing the workspace, allows owner/admin", () => {
    expect(() => assertCanManageWorkspace("OPERATOR")).toThrow(PermissionError);
    expect(() => assertCanManageWorkspace("VIEWER")).toThrow(PermissionError);
    expect(() => assertCanManageWorkspace("ADMIN")).not.toThrow();
    expect(() => assertCanManageWorkspace("OWNER")).not.toThrow();
  });

  it("throws for a read-only role mutating workspace data, allows the rest", () => {
    expect(() => assertCanMutateWorkspaceData("VIEWER")).toThrow(PermissionError);
    expect(() => assertCanMutateWorkspaceData("OPERATOR")).not.toThrow();
    expect(() => assertCanMutateWorkspaceData("ADMIN")).not.toThrow();
    expect(() => assertCanMutateWorkspaceData("OWNER")).not.toThrow();
  });
});
