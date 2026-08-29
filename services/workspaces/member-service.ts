import { createClient } from "@/lib/supabase/server";
import { ValidationError } from "@/lib/errors";
import {
  inviteMemberSchema,
  removeMemberSchema,
  updateMemberRoleSchema,
} from "@/lib/validation/workspace";
import type { WorkspaceRole } from "@/types/status";

export async function addWorkspaceMember(input: {
  workspaceId: string;
  email: string;
  role: WorkspaceRole;
}): Promise<string> {
  const parsed = inviteMemberSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid invite");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("add_workspace_member", {
    p_workspace_id: parsed.data.workspaceId,
    p_email: parsed.data.email,
    p_role: parsed.data.role,
  });

  if (error || !data) {
    throw new ValidationError(error?.message ?? "Unable to add member");
  }

  return data;
}

export async function updateWorkspaceMemberRole(input: {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
}): Promise<void> {
  const parsed = updateMemberRoleSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid role change");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_workspace_member_role", {
    p_workspace_id: parsed.data.workspaceId,
    p_user_id: parsed.data.userId,
    p_role: parsed.data.role,
  });

  if (error) {
    throw new ValidationError(error.message);
  }
}

export async function removeWorkspaceMember(input: {
  workspaceId: string;
  userId: string;
}): Promise<void> {
  const parsed = removeMemberSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid member");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_workspace_member", {
    p_workspace_id: parsed.data.workspaceId,
    p_user_id: parsed.data.userId,
  });

  if (error) {
    throw new ValidationError(error.message);
  }
}
