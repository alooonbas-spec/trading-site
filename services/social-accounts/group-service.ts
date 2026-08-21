import { createClient } from "@/lib/supabase/server";
import { canManageAccounts } from "@/lib/auth/permissions";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { PermissionError, ValidationError } from "@/lib/errors";
import type { AccountGroup } from "@/types/social-account";

export async function listAccountGroups(workspaceId: string): Promise<AccountGroup[]> {
  const supabase = await createClient();
  const [{ data: groups, error: groupError }, { data: members, error: memberError }] =
    await Promise.all([
      supabase
        .from("account_groups")
        .select("id, workspace_id, name, description, created_at, updated_at")
        .eq("workspace_id", workspaceId)
        .order("name", { ascending: true }),
      supabase
        .from("account_group_members")
        .select("group_id, social_account_id")
        .eq("workspace_id", workspaceId),
    ]);

  if (groupError) {
    throw new Error(groupError.message);
  }
  if (memberError) {
    throw new Error(memberError.message);
  }

  const membersByGroup = new Map<string, string[]>();
  for (const member of members ?? []) {
    const current = membersByGroup.get(member.group_id) ?? [];
    current.push(member.social_account_id);
    membersByGroup.set(member.group_id, current);
  }

  return (groups ?? []).map((group) => ({
    id: group.id,
    workspaceId: group.workspace_id,
    name: group.name,
    description: group.description,
    accountIds: membersByGroup.get(group.id) ?? [],
    createdAt: group.created_at,
    updatedAt: group.updated_at,
  }));
}

export async function createAccountGroup(input: {
  workspaceId: string;
  name: string;
  description?: string;
  accountIds: string[];
}): Promise<AccountGroup> {
  const context = await requireWorkspaceContext(input.workspaceId);
  if (!canManageAccounts(context.role)) {
    throw new PermissionError("Only owners and admins can manage account groups");
  }

  const name = input.name.trim();
  if (name.length < 2) {
    throw new ValidationError("Group name must be at least 2 characters");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("account_groups")
    .insert({
      workspace_id: input.workspaceId,
      name,
      description: input.description?.trim() || null,
    })
    .select("id, workspace_id, name, description, created_at, updated_at")
    .single();

  if (error || !data) {
    throw new ValidationError(error?.message ?? "Unable to create group");
  }

  if (input.accountIds.length > 0) {
    const { error: memberError } = await supabase.from("account_group_members").insert(
      input.accountIds.map((accountId) => ({
        workspace_id: input.workspaceId,
        group_id: data.id,
        social_account_id: accountId,
      })),
    );
    if (memberError) {
      throw new ValidationError(memberError.message);
    }
  }

  return {
    id: data.id,
    workspaceId: data.workspace_id,
    name: data.name,
    description: data.description,
    accountIds: input.accountIds,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

export async function deleteAccountGroup(input: { workspaceId: string; groupId: string }): Promise<void> {
  const context = await requireWorkspaceContext(input.workspaceId);
  if (!canManageAccounts(context.role)) {
    throw new PermissionError("Only owners and admins can manage account groups");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("account_groups")
    .delete()
    .eq("id", input.groupId)
    .eq("workspace_id", input.workspaceId);

  if (error) {
    throw new ValidationError(error.message);
  }
}
