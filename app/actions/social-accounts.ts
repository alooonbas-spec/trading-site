"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";
import { connectSocialAccount, disconnectSocialAccount, parsePlatform, refreshSocialAccountHealth, updateSocialAccountPublishDestination } from "@/services/social-accounts/account-service";
import { startOAuthConnect } from "@/services/social-accounts/oauth-service";
import { createAccountGroup, deleteAccountGroup } from "@/services/social-accounts/group-service";
import { normalizeTelegramChatId } from "@/social/telegram/adapter";

export type ActionState = {
  error: string | null;
  success: string | null;
};

export const idleActionState: ActionState = { error: null, success: null };

export async function connectTelegramAction(
  workspaceId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const publishChatId = String(formData.get("publishChatId") ?? "").trim();
    await connectSocialAccount({
      workspaceId,
      platform: "telegram",
      connectInput: { credential: String(formData.get("token") ?? "") },
      metadata: publishChatId ? { publishChatId: normalizeTelegramChatId(publishChatId) } : undefined,
    });
  } catch (error) {
    return { error: errorMessage(error, "Unable to connect Telegram"), success: null };
  }

  revalidatePath(`/w/${workspaceId}/social-accounts`);
  return { error: null, success: "Telegram account connected" };
}

export async function updatePublishDestinationAction(
  workspaceId: string,
  accountId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const destination: Record<string, string> = {};
    const pageId = formData.get("pageId");
    const publishOwnerId = formData.get("publishOwnerId");
    const publishChatId = formData.get("publishChatId");
    if (typeof pageId === "string") {
      destination.pageId = pageId;
    }
    if (typeof publishOwnerId === "string") {
      destination.publishOwnerId = publishOwnerId;
    }
    if (typeof publishChatId === "string") {
      destination.publishChatId = publishChatId.trim()
        ? normalizeTelegramChatId(publishChatId)
        : "";
    }
    await updateSocialAccountPublishDestination({ workspaceId, accountId, destination });
  } catch (error) {
    return { error: errorMessage(error, "Unable to update publish destination"), success: null };
  }

  revalidatePath(`/w/${workspaceId}/social-accounts`);
  return { error: null, success: "Publish destination saved" };
}

export async function startOAuthAction(workspaceId: string, platform: string): Promise<ActionState> {
  let url: string;
  try {
    url = await startOAuthConnect({
      workspaceId,
      platform: parsePlatform(platform),
    });
  } catch (error) {
    return { error: errorMessage(error, "Unable to start OAuth"), success: null };
  }

  redirect(url);
}

export async function refreshAccountAction(workspaceId: string, accountId: string): Promise<ActionState> {
  try {
    await refreshSocialAccountHealth({ workspaceId, accountId });
    revalidatePath(`/w/${workspaceId}/social-accounts`);
    return { error: null, success: "Health updated" };
  } catch (error) {
    return { error: errorMessage(error), success: null };
  }
}

export async function disconnectAccountAction(workspaceId: string, accountId: string): Promise<ActionState> {
  try {
    await disconnectSocialAccount({ workspaceId, accountId });
    revalidatePath(`/w/${workspaceId}/social-accounts`);
    return { error: null, success: "Account disconnected" };
  } catch (error) {
    return { error: errorMessage(error), success: null };
  }
}

export async function createGroupAction(
  workspaceId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const accountIds = formData.getAll("accountIds").map(String).filter(Boolean);
    await createAccountGroup({
      workspaceId,
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? ""),
      accountIds,
    });
    revalidatePath(`/w/${workspaceId}/social-accounts`);
    return { error: null, success: "Group created" };
  } catch (error) {
    return { error: errorMessage(error), success: null };
  }
}

export async function deleteGroupAction(workspaceId: string, groupId: string): Promise<ActionState> {
  try {
    await deleteAccountGroup({ workspaceId, groupId });
    revalidatePath(`/w/${workspaceId}/social-accounts`);
    return { error: null, success: "Group deleted" };
  } catch (error) {
    return { error: errorMessage(error), success: null };
  }
}
