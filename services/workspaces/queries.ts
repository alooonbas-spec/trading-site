import { createClient } from "@/lib/supabase/server";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { ValidationError } from "@/lib/errors";
import {
  DEFAULT_PAGE_SIZE,
  keysetOrFilter,
  nextKeysetCursor,
  parseKeysetCursor,
  splitKeysetRows,
  type KeysetPage,
} from "@/lib/pagination/keyset";
import { WORKSPACE_ROLES, type WorkspaceRole } from "@/types/status";

export type WorkspaceMemberView = {
  id: string;
  userId: string;
  email: string;
  displayName: string | null;
  role: WorkspaceRole;
  createdAt: string;
};

const MEMBER_PAGE_SIZE = DEFAULT_PAGE_SIZE;

export async function listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMemberView[]> {
  const supabase = await createClient();
  const { data: members, error } = await supabase
    .from("workspace_members")
    .select("id, user_id, role, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return attachMemberProfiles(members ?? []);
}

export async function listWorkspaceMembersPage(
  workspaceId: string,
  after?: string,
): Promise<KeysetPage<WorkspaceMemberView>> {
  await requireWorkspaceContext(workspaceId);
  const supabase = await createClient();
  const cursor = parseKeysetCursor(after);
  let request = supabase
    .from("workspace_members")
    .select("id, user_id, role, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(MEMBER_PAGE_SIZE + 1);
  if (cursor) {
    request = request.or(keysetOrFilter(cursor));
  }

  const { data, error } = await request;
  if (error) {
    throw new ValidationError(error.message);
  }

  const { page, hasMore } = splitKeysetRows(data ?? [], MEMBER_PAGE_SIZE);
  return {
    items: await attachMemberProfiles(page),
    nextCursor: nextKeysetCursor(page, hasMore),
  };
}

async function attachMemberProfiles(
  members: Array<{ id: string; user_id: string; role: string; created_at: string }>,
): Promise<WorkspaceMemberView[]> {
  if (members.length === 0) {
    return [];
  }

  const supabase = await createClient();
  const userIds = [...new Set(members.map((member) => member.user_id))];
  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id, email, display_name")
    .in("id", userIds);

  if (profileError) {
    throw new ValidationError(profileError.message);
  }

  const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  return members.map((member) => {
    const profile = profileMap.get(member.user_id);
    return {
      id: member.id,
      userId: member.user_id,
      email: profile?.email ?? "unknown",
      displayName: profile?.display_name ?? null,
      role: toWorkspaceRole(member.role),
      createdAt: member.created_at,
    };
  });
}

export async function countWorkspaceMembers(workspaceId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("workspace_members")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);

  if (error) {
    throw new Error(error.message);
  }

  return count ?? 0;
}

export async function countTodayActivity(workspaceId: string): Promise<number> {
  const supabase = await createClient();
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const { count, error } = await supabase
    .from("activity_log")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .gte("created_at", startOfDay.toISOString());

  if (error) {
    throw new Error(error.message);
  }

  return count ?? 0;
}

function toWorkspaceRole(value: string): WorkspaceRole {
  if ((WORKSPACE_ROLES as readonly string[]).includes(value)) {
    return value as WorkspaceRole;
  }
  throw new ValidationError("Unknown workspace role");
}
