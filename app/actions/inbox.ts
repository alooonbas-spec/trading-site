"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";
import { attachInboxEventToLead } from "@/services/inbox/attach-service";
import { replyToInboxEvent } from "@/services/inbox/reply-service";

export type ActionState = {
  error: string | null;
  success: string | null;
};

export const idleActionState: ActionState = { error: null, success: null };

export async function attachInboxEventAction(
  workspaceId: string,
  inboxEventId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const result = await attachInboxEventToLead({
      workspaceId,
      inboxEventId,
      leadId: String(formData.get("leadId") ?? ""),
    });
    revalidatePath(`/w/${workspaceId}/inbox`);
    revalidatePath(`/w/${workspaceId}/leads`);
    revalidatePath(`/w/${workspaceId}/leads/${String(formData.get("leadId") ?? "")}`);
    const profilePart = result.profileCreated ? "Linked a social profile and attached" : "Attached";
    return {
      error: null,
      success: `${profilePart} ${result.attached} inbox event${result.attached === 1 ? "" : "s"}`,
    };
  } catch (error) {
    return { error: errorMessage(error, "Unable to attach inbox event"), success: null };
  }
}

export async function replyInboxEventAction(
  workspaceId: string,
  inboxEventId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const result = await replyToInboxEvent({
      workspaceId,
      inboxEventId,
      body: String(formData.get("body") ?? ""),
    });
    revalidatePath(`/w/${workspaceId}/inbox`);
    revalidatePath(`/w/${workspaceId}/leads`);
    if (result.leadId) {
      revalidatePath(`/w/${workspaceId}/leads/${result.leadId}`);
    }
    return { error: null, success: "Reply sent" };
  } catch (error) {
    return { error: errorMessage(error, "Unable to send inbox reply"), success: null };
  }
}
