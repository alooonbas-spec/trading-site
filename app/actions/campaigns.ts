"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { errorMessage } from "@/lib/errors";
import {
  cancelCampaign,
  createCampaign,
  deleteCampaign,
  pauseCampaign,
  startCampaign,
} from "@/services/campaigns/campaign-service";
import { processJobBatch } from "@/services/jobs/worker-service";
import { CAMPAIGN_ACTIONS, type CampaignAction } from "@/types/campaign";

export type ActionState = {
  error: string | null;
  success: string | null;
};

export const idleActionState: ActionState = { error: null, success: null };

function parseAction(value: string): CampaignAction | undefined {
  if ((CAMPAIGN_ACTIONS as readonly string[]).includes(value)) {
    return value as CampaignAction;
  }
  return undefined;
}

export async function createCampaignAction(
  workspaceId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const action = parseAction(String(formData.get("action") ?? ""));
  if (!action) {
    return { error: "Choose a campaign action", success: null };
  }

  let campaignId: string;
  try {
    const campaign = await createCampaign({
      workspaceId,
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? ""),
      action,
      body: String(formData.get("body") ?? ""),
      leadIds: formData.getAll("leadIds").map(String).filter(Boolean),
      accountIds: formData.getAll("accountIds").map(String).filter(Boolean),
    });
    campaignId = campaign.id;
  } catch (error) {
    return { error: errorMessage(error, "Unable to create campaign"), success: null };
  }

  revalidatePath(`/w/${workspaceId}/campaigns`);
  redirect(`/w/${workspaceId}/campaigns/${campaignId}`);
}

export async function startCampaignAction(workspaceId: string, campaignId: string): Promise<ActionState> {
  try {
    await startCampaign({ workspaceId, campaignId });
    revalidatePath(`/w/${workspaceId}/campaigns`);
    revalidatePath(`/w/${workspaceId}/campaigns/${campaignId}`);
    return { error: null, success: "Campaign started and jobs queued" };
  } catch (error) {
    return { error: errorMessage(error), success: null };
  }
}

export async function pauseCampaignAction(workspaceId: string, campaignId: string): Promise<ActionState> {
  try {
    await pauseCampaign({ workspaceId, campaignId });
    revalidatePath(`/w/${workspaceId}/campaigns`);
    revalidatePath(`/w/${workspaceId}/campaigns/${campaignId}`);
    return { error: null, success: "Campaign paused" };
  } catch (error) {
    return { error: errorMessage(error), success: null };
  }
}

export async function cancelCampaignAction(workspaceId: string, campaignId: string): Promise<ActionState> {
  try {
    await cancelCampaign({ workspaceId, campaignId });
    revalidatePath(`/w/${workspaceId}/campaigns`);
    revalidatePath(`/w/${workspaceId}/campaigns/${campaignId}`);
    return { error: null, success: "Campaign cancelled" };
  } catch (error) {
    return { error: errorMessage(error), success: null };
  }
}

export async function deleteCampaignAction(workspaceId: string, campaignId: string): Promise<ActionState> {
  try {
    await deleteCampaign({ workspaceId, campaignId });
  } catch (error) {
    return { error: errorMessage(error), success: null };
  }

  revalidatePath(`/w/${workspaceId}/campaigns`);
  redirect(`/w/${workspaceId}/campaigns`);
}

export async function processQueueAction(workspaceId: string, campaignId?: string): Promise<ActionState> {
  try {
    const result = await processJobBatch({ workspaceId, limit: 20 });
    revalidatePath(`/w/${workspaceId}/campaigns`);
    if (campaignId) {
      revalidatePath(`/w/${workspaceId}/campaigns/${campaignId}`);
    }
    revalidatePath(`/w/${workspaceId}/social-accounts`);
    revalidatePath(`/w/${workspaceId}/posts`);
    return {
      error: null,
      success: `Processed ${result.processed} job${result.processed === 1 ? "" : "s"} (${result.claimed} claimed)`,
    };
  } catch (error) {
    return { error: errorMessage(error), success: null };
  }
}
