import { z } from "zod";

export const ASSIGNABLE_ROLES = ["ADMIN", "OPERATOR", "VIEWER"] as const;

export const workspaceNameSchema = z
  .string()
  .trim()
  .min(2, "Workspace name must be at least 2 characters")
  .max(80, "Workspace name is too long");

export const createWorkspaceSchema = z.object({
  name: workspaceNameSchema,
});

export const updateWorkspaceSchema = z.object({
  workspaceId: z.uuid(),
  name: workspaceNameSchema,
});

export const inviteMemberSchema = z.object({
  workspaceId: z.uuid(),
  email: z.email("Enter a valid email"),
  role: z.enum(ASSIGNABLE_ROLES),
});

export const updateMemberRoleSchema = z.object({
  workspaceId: z.uuid(),
  userId: z.uuid(),
  role: z.enum(ASSIGNABLE_ROLES),
});

export const removeMemberSchema = z.object({
  workspaceId: z.uuid(),
  userId: z.uuid(),
});

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
