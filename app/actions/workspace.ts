"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { errorMessage } from "@/lib/errors";
import { createWorkspace, deleteWorkspace, updateWorkspace } from "@/services/workspaces/workspace-service";
import {
  addWorkspaceMember,
  removeWorkspaceMember,
  updateWorkspaceMemberRole,
} from "@/services/workspaces/member-service";
import type { WorkspaceRole } from "@/types/status";

export type ActionState = {
  error: string | null;
  success: string | null;
};

export const idleActionState: ActionState = { error: null, success: null };

export async function createWorkspaceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let workspaceId: string;
  try {
    workspaceId = await createWorkspace(String(formData.get("name") ?? ""));
  } catch (error) {
    return { error: errorMessage(error, "Unable to create workspace"), success: null };
  }

  revalidatePath("/");
  redirect(`/w/${workspaceId}`);
}

export async function updateWorkspaceAction(
  workspaceId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await updateWorkspace(workspaceId, String(formData.get("name") ?? ""));
    revalidatePath(`/w/${workspaceId}`);
    revalidatePath(`/w/${workspaceId}/settings`);
    return { error: null, success: "Workspace updated" };
  } catch (error) {
    return { error: errorMessage(error), success: null };
  }
}

export async function deleteWorkspaceAction(workspaceId: string): Promise<ActionState> {
  try {
    await deleteWorkspace(workspaceId);
  } catch (error) {
    return { error: errorMessage(error), success: null };
  }

  revalidatePath("/");
  redirect("/onboarding");
}

export async function inviteMemberAction(
  workspaceId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await addWorkspaceMember({
      workspaceId,
      email: String(formData.get("email") ?? ""),
      role: String(formData.get("role") ?? "OPERATOR") as Exclude<WorkspaceRole, "OWNER">,
    });
    revalidatePath(`/w/${workspaceId}/settings`);
    return { error: null, success: "Member added" };
  } catch (error) {
    return { error: errorMessage(error), success: null };
  }
}

export async function updateMemberRoleAction(
  workspaceId: string,
  userId: string,
  role: Exclude<WorkspaceRole, "OWNER">,
): Promise<ActionState> {
  try {
    await updateWorkspaceMemberRole({ workspaceId, userId, role });
    revalidatePath(`/w/${workspaceId}/settings`);
    return { error: null, success: "Role updated" };
  } catch (error) {
    return { error: errorMessage(error), success: null };
  }
}

export async function removeMemberAction(
  workspaceId: string,
  userId: string,
): Promise<ActionState> {
  try {
    await removeWorkspaceMember({ workspaceId, userId });
    revalidatePath(`/w/${workspaceId}/settings`);
    return { error: null, success: "Member removed" };
  } catch (error) {
    return { error: errorMessage(error), success: null };
  }
}
