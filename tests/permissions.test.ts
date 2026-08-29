import { describe, expect, it } from "vitest";
import {
  assertCanAssignRole,
  canAssignRole,
  canManageAccounts,
  canManageMembers,
  canMutateWorkspaceData,
  isReadOnlyRole,
} from "@/lib/auth/permissions";
import { PermissionError } from "@/lib/errors";

describe("workspace permissions", () => {
  it("maps roles to the specified access model", () => {
    expect(canManageMembers("OWNER")).toBe(true);
    expect(canManageMembers("ADMIN")).toBe(true);
    expect(canManageMembers("OPERATOR")).toBe(false);
    expect(canManageAccounts("OWNER")).toBe(true);
    expect(canManageAccounts("ADMIN")).toBe(true);
    expect(canManageAccounts("OPERATOR")).toBe(false);
    expect(canMutateWorkspaceData("OPERATOR")).toBe(true);
    expect(isReadOnlyRole("VIEWER")).toBe(true);
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
  });
});
