import { createClient } from "@/lib/supabase/server";

export type WorkspaceMemberView = {
  id: string;
  userId: string;
  email: string;
  displayName: string | null;
  role: "OWNER" | "ADMIN" | "OPERATOR" | "VIEWER";
  createdAt: string;
};

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

  const userIds = (members ?? []).map((member) => member.user_id);
  if (userIds.length === 0) {
    return [];
  }

  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id, email, display_name")
    .in("id", userIds);

  if (profileError) {
    throw new Error(profileError.message);
  }

  const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile]));

  return (members ?? []).map((member) => {
    const profile = profileMap.get(member.user_id);
    return {
      id: member.id,
      userId: member.user_id,
      email: profile?.email ?? "unknown",
      displayName: profile?.display_name ?? null,
      role: member.role,
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
