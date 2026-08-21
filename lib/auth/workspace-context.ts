import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/session";
import type { SessionWorkspaceContext, Workspace, WorkspaceMembership } from "@/types/workspace";

function mapWorkspace(row: {
  id: string;
  name: string;
  slug: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}): Workspace {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listMemberships(userId: string): Promise<WorkspaceMembership[]> {
  const supabase = await createClient();
  const { data: memberRows, error: memberError } = await supabase
    .from("workspace_members")
    .select("workspace_id, role, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (memberError) {
    throw new Error(memberError.message);
  }

  if (!memberRows || memberRows.length === 0) {
    return [];
  }

  const workspaceIds = memberRows.map((row) => row.workspace_id);
  const { data: workspaces, error: workspaceError } = await supabase
    .from("workspaces")
    .select("id, name, slug, created_by, created_at, updated_at")
    .in("id", workspaceIds);

  if (workspaceError) {
    throw new Error(workspaceError.message);
  }

  const workspaceMap = new Map((workspaces ?? []).map((workspace) => [workspace.id, workspace]));

  return memberRows.flatMap((row) => {
    const workspace = workspaceMap.get(row.workspace_id);
    if (!workspace) {
      return [];
    }

    return [
      {
        role: row.role,
        workspace: mapWorkspace(workspace),
      },
    ];
  });
}

export async function requireWorkspaceContext(
  workspaceId: string,
): Promise<SessionWorkspaceContext> {
  const profile = await requireProfile();
  const memberships = await listMemberships(profile.id);
  const current = memberships.find((item) => item.workspace.id === workspaceId);

  if (!current) {
    notFound();
  }

  return {
    user: profile,
    workspace: current.workspace,
    role: current.role,
    memberships,
  };
}

export async function getDefaultWorkspaceId(userId: string, preferredId: string | null) {
  const memberships = await listMemberships(userId);
  if (preferredId && memberships.some((item) => item.workspace.id === preferredId)) {
    return preferredId;
  }

  return memberships[0]?.workspace.id ?? null;
}
