"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { errorMessage } from "@/lib/errors";
import { parseMediaList, parseScheduledAt } from "@/lib/validation/post";
import { cancelPost, createPost, deletePost, publishPost } from "@/services/posts/post-service";
import { processJobBatch } from "@/services/jobs/worker-service";

export type ActionState = {
  error: string | null;
  success: string | null;
};

export const idleActionState: ActionState = { error: null, success: null };

export async function createPostAction(
  workspaceId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let postId: string;
  try {
    const post = await createPost({
      workspaceId,
      body: String(formData.get("body") ?? ""),
      media: parseMediaList(String(formData.get("media") ?? "")),
      accountIds: formData.getAll("accountIds").map(String).filter(Boolean),
      scheduledAt: parseScheduledAt(String(formData.get("scheduledAt") ?? "")),
    });
    postId = post.id;
  } catch (error) {
    return { error: errorMessage(error, "Unable to create post"), success: null };
  }

  revalidatePath(`/w/${workspaceId}/posts`);
  redirect(`/w/${workspaceId}/posts/${postId}`);
}

export async function publishPostAction(workspaceId: string, postId: string): Promise<ActionState> {
  try {
    const queued = await publishPost({ workspaceId, postId });
    revalidatePath(`/w/${workspaceId}/posts`);
    revalidatePath(`/w/${workspaceId}/posts/${postId}`);
    return { error: null, success: `Queued ${queued} publish job${queued === 1 ? "" : "s"}` };
  } catch (error) {
    return { error: errorMessage(error), success: null };
  }
}

export async function cancelPostAction(workspaceId: string, postId: string): Promise<ActionState> {
  try {
    await cancelPost({ workspaceId, postId });
    revalidatePath(`/w/${workspaceId}/posts`);
    revalidatePath(`/w/${workspaceId}/posts/${postId}`);
    return { error: null, success: "Post cancelled" };
  } catch (error) {
    return { error: errorMessage(error), success: null };
  }
}

export async function deletePostAction(workspaceId: string, postId: string): Promise<ActionState> {
  try {
    await deletePost({ workspaceId, postId });
  } catch (error) {
    return { error: errorMessage(error), success: null };
  }

  revalidatePath(`/w/${workspaceId}/posts`);
  redirect(`/w/${workspaceId}/posts`);
}

export async function processPublishQueueAction(workspaceId: string, postId: string): Promise<ActionState> {
  try {
    const result = await processJobBatch({ workspaceId, limit: 20 });
    revalidatePath(`/w/${workspaceId}/posts`);
    revalidatePath(`/w/${workspaceId}/posts/${postId}`);
    revalidatePath(`/w/${workspaceId}/social-accounts`);
    return {
      error: null,
      success: `Processed ${result.processed} job${result.processed === 1 ? "" : "s"} (${result.claimed} claimed)`,
    };
  } catch (error) {
    return { error: errorMessage(error), success: null };
  }
}
