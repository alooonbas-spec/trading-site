"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";
import { cancelQueuedJob, retryFailedJob } from "@/services/jobs/control-service";
import { processJobBatch } from "@/services/jobs/worker-service";

export type ActionState = {
  error: string | null;
  success: string | null;
};

export const idleActionState: ActionState = { error: null, success: null };

function revalidateJobPaths(workspaceId: string): void {
  revalidatePath(`/w/${workspaceId}/jobs`);
  revalidatePath(`/w/${workspaceId}/campaigns`);
  revalidatePath(`/w/${workspaceId}/posts`);
  revalidatePath(`/w/${workspaceId}/monitoring`);
  revalidatePath(`/w/${workspaceId}/inbox`);
  revalidatePath(`/w/${workspaceId}/social-accounts`);
}

export async function retryFailedJobAction(workspaceId: string, jobId: string): Promise<ActionState> {
  try {
    await retryFailedJob({ workspaceId, jobId });
    revalidateJobPaths(workspaceId);
    return { error: null, success: "Job queued for retry" };
  } catch (error) {
    return { error: errorMessage(error, "Unable to retry job"), success: null };
  }
}

export async function cancelQueuedJobAction(workspaceId: string, jobId: string): Promise<ActionState> {
  try {
    await cancelQueuedJob({ workspaceId, jobId });
    revalidateJobPaths(workspaceId);
    return { error: null, success: "Job cancelled" };
  } catch (error) {
    return { error: errorMessage(error, "Unable to cancel job"), success: null };
  }
}

export async function processWorkspaceQueueAction(workspaceId: string): Promise<ActionState> {
  try {
    const result = await processJobBatch({ workspaceId, limit: 20 });
    revalidateJobPaths(workspaceId);
    return {
      error: null,
      success: `Processed ${result.processed} job${result.processed === 1 ? "" : "s"} (${result.claimed} claimed)`,
    };
  } catch (error) {
    return { error: errorMessage(error, "Unable to process queue"), success: null };
  }
}
