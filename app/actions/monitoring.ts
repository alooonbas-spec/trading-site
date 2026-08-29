"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { errorMessage } from "@/lib/errors";
import { parseKeywordsField, parseSourceList } from "@/lib/validation/monitoring";
import {
  createMonitoringRule,
  deleteMonitoringRule,
  disableMonitoringRule,
  pauseMonitoringRule,
  resumeMonitoringRule,
  runMonitoringRule,
} from "@/services/monitoring/rule-service";
import { processJobBatch } from "@/services/jobs/worker-service";
import { SOCIAL_PLATFORMS, type SocialPlatform } from "@/types/social";

export type ActionState = {
  error: string | null;
  success: string | null;
};

export const idleActionState: ActionState = { error: null, success: null };

function parsePlatform(value: string): SocialPlatform | undefined {
  if ((SOCIAL_PLATFORMS as readonly string[]).includes(value)) {
    return value as SocialPlatform;
  }
  return undefined;
}

export async function createMonitoringRuleAction(
  workspaceId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const platform = parsePlatform(String(formData.get("platform") ?? ""));
  if (!platform) {
    return { error: "Choose a platform", success: null };
  }

  const accountRaw = String(formData.get("socialAccountId") ?? "").trim();
  let ruleId: string;
  try {
    const rule = await createMonitoringRule({
      workspaceId,
      name: String(formData.get("name") ?? ""),
      keywords: parseKeywordsField(String(formData.get("keywords") ?? "")),
      sources: parseSourceList(String(formData.get("sources") ?? "")),
      platform,
      socialAccountId: accountRaw.length > 0 ? accountRaw : null,
    });
    ruleId = rule.id;
  } catch (error) {
    return { error: errorMessage(error, "Unable to create monitoring rule"), success: null };
  }

  revalidatePath(`/w/${workspaceId}/monitoring`);
  redirect(`/w/${workspaceId}/monitoring/${ruleId}`);
}

export async function runMonitoringRuleAction(workspaceId: string, ruleId: string): Promise<ActionState> {
  try {
    const queued = await runMonitoringRule({ workspaceId, ruleId });
    revalidatePath(`/w/${workspaceId}/monitoring`);
    revalidatePath(`/w/${workspaceId}/monitoring/${ruleId}`);
    return {
      error: null,
      success: queued === 0 ? "A monitoring job is already queued" : "Queued a monitoring job",
    };
  } catch (error) {
    return { error: errorMessage(error), success: null };
  }
}

export async function pauseMonitoringRuleAction(workspaceId: string, ruleId: string): Promise<ActionState> {
  try {
    await pauseMonitoringRule({ workspaceId, ruleId });
    revalidatePath(`/w/${workspaceId}/monitoring`);
    revalidatePath(`/w/${workspaceId}/monitoring/${ruleId}`);
    return { error: null, success: "Monitoring rule paused" };
  } catch (error) {
    return { error: errorMessage(error), success: null };
  }
}

export async function resumeMonitoringRuleAction(workspaceId: string, ruleId: string): Promise<ActionState> {
  try {
    const queued = await resumeMonitoringRule({ workspaceId, ruleId });
    revalidatePath(`/w/${workspaceId}/monitoring`);
    revalidatePath(`/w/${workspaceId}/monitoring/${ruleId}`);
    return {
      error: null,
      success: queued === 0 ? "Rule resumed. A monitoring job is already queued" : "Rule resumed and queued",
    };
  } catch (error) {
    return { error: errorMessage(error), success: null };
  }
}

export async function disableMonitoringRuleAction(workspaceId: string, ruleId: string): Promise<ActionState> {
  try {
    await disableMonitoringRule({ workspaceId, ruleId });
    revalidatePath(`/w/${workspaceId}/monitoring`);
    revalidatePath(`/w/${workspaceId}/monitoring/${ruleId}`);
    return { error: null, success: "Monitoring rule disabled" };
  } catch (error) {
    return { error: errorMessage(error), success: null };
  }
}

export async function deleteMonitoringRuleAction(workspaceId: string, ruleId: string): Promise<ActionState> {
  try {
    await deleteMonitoringRule({ workspaceId, ruleId });
  } catch (error) {
    return { error: errorMessage(error), success: null };
  }

  revalidatePath(`/w/${workspaceId}/monitoring`);
  redirect(`/w/${workspaceId}/monitoring`);
}

export async function processMonitoringQueueAction(workspaceId: string, ruleId: string): Promise<ActionState> {
  try {
    const result = await processJobBatch({ workspaceId, limit: 20 });
    revalidatePath(`/w/${workspaceId}/monitoring`);
    revalidatePath(`/w/${workspaceId}/monitoring/${ruleId}`);
    revalidatePath(`/w/${workspaceId}`);
    return {
      error: null,
      success: `Processed ${result.processed} job${result.processed === 1 ? "" : "s"} (${result.claimed} claimed)`,
    };
  } catch (error) {
    return { error: errorMessage(error), success: null };
  }
}
