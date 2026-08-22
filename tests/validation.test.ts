import { describe, expect, it } from "vitest";
import { loginSchema, signupSchema } from "@/lib/validation/auth";
import {
  createWorkspaceSchema,
  inviteMemberSchema,
  removeMemberSchema,
  updateMemberRoleSchema,
  updateWorkspaceSchema,
} from "@/lib/validation/workspace";
import { publicEnvSchema } from "@/lib/validation/env";

describe("validation", () => {
  it("rejects short passwords", () => {
    const result = loginSchema.safeParse({ email: "alex@example.com", password: "short" });
    expect(result.success).toBe(false);
  });

  it("accepts a valid signup payload", () => {
    const result = signupSchema.safeParse({
      email: "alex@example.com",
      password: "long-enough",
      displayName: "Alex",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a workspace name that is too short", () => {
    expect(createWorkspaceSchema.safeParse({ name: "A" }).success).toBe(false);
    expect(createWorkspaceSchema.safeParse({ name: "Trading" }).success).toBe(true);
  });

  it("rejects owner as an invite role", () => {
    const result = inviteMemberSchema.safeParse({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      email: "alex@example.com",
      role: "OWNER",
    });
    expect(result.success).toBe(false);
  });

  it("requires a workspace id and a valid name to rename a workspace", () => {
    const workspaceId = "11111111-1111-4111-8111-111111111111";
    expect(updateWorkspaceSchema.safeParse({ workspaceId, name: "Trading" }).success).toBe(true);
    expect(updateWorkspaceSchema.safeParse({ workspaceId, name: "A" }).success).toBe(false);
    expect(updateWorkspaceSchema.safeParse({ workspaceId: "not-a-uuid", name: "Trading" }).success).toBe(
      false,
    );
  });

  it("rejects owner as a role change, and requires uuids to change or remove a member", () => {
    const workspaceId = "11111111-1111-4111-8111-111111111111";
    const userId = "22222222-2222-4222-8222-222222222222";
    expect(updateMemberRoleSchema.safeParse({ workspaceId, userId, role: "ADMIN" }).success).toBe(true);
    expect(updateMemberRoleSchema.safeParse({ workspaceId, userId, role: "OWNER" }).success).toBe(false);
    expect(removeMemberSchema.safeParse({ workspaceId, userId }).success).toBe(true);
    expect(removeMemberSchema.safeParse({ workspaceId, userId: "not-a-uuid" }).success).toBe(false);
  });

  it("requires a real supabase public url", () => {
    expect(
      publicEnvSchema.safeParse({
        NEXT_PUBLIC_SUPABASE_URL: "not-a-url",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "key",
      }).success,
    ).toBe(false);
  });
});
