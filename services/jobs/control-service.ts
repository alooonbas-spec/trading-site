import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/session";
import { assertCanMutateWorkspaceData } from "@/lib/auth/permissions";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { ValidationError } from "@/lib/errors";
import { canCancelJob, canRetryFailedJob, isStaleRunningJob } from "@/lib/jobs/status";
import { STALE_RUNNING_JOB_MS } from "@/lib/jobs/queue-rules";
import { logActivity } from "@/services/activity/activity-service";
import { toJob } from "@/services/campaigns/mapper";
import { refreshPostRollup } from "@/services/posts/post-service";
import { CAMPAIGN_PUBLIC_COLUMNS, JOB_PUBLIC_COLUMNS } from "@/types/campaign";
import { MONITORING_RULE_PUBLIC_COLUMNS } from "@/types/monitoring";
import { POST_PUBLIC_COLUMNS, POST_TARGET_PUBLIC_COLUMNS } from "@/types/post";
import type { CampaignStatus, MonitoringRuleStatus, PostStatus, PostTargetStatus } from "@/types/status";

const jobIdSchema = z.uuid();

export async function retryFailedJob(input: {
  workspaceId: string;
  jobId: string;
}): Promise<void> {
  const context = await requireWorkspaceContext(input.workspaceId);
  assertCanMutateWorkspaceData(context.role);
  const jobId = jobIdSchema.parse(input.jobId);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .select(JOB_PUBLIC_COLUMNS)
    .eq("id", jobId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();

  if (error) {
    throw new ValidationError(error.message);
  }
  if (!data) {
    throw new ValidationError("Job not found");
  }

  const job = toJob(data);
  const parents = await loadJobParents(input.workspaceId, job);
  if (
    !canRetryFailedJob({
      jobStatus: job.status,
      jobType: job.type,
      campaignStatus: parents.campaignStatus,
      postStatus: parents.postStatus,
      postTargetStatus: parents.postTargetStatus,
      monitoringRuleStatus: parents.monitoringRuleStatus,
    })
  ) {
    throw new ValidationError(retryBlockedMessage(job.type, job.status));
  }

  if (job.postTargetId && parents.postTargetStatus === "FAILED") {
    const { error: targetError } = await supabase
      .from("post_targets")
      .update({ status: "PENDING", last_error: null })
      .eq("id", job.postTargetId)
      .eq("workspace_id", input.workspaceId)
      .eq("status", "FAILED");
    if (targetError) {
      throw new ValidationError(targetError.message);
    }
  }

  const { error: updateError } = await supabase
    .from("jobs")
    .update({
      status: "PENDING",
      attempts: 0,
      run_after: new Date().toISOString(),
      locked_at: null,
      locked_by: null,
      completed_at: null,
      last_error: null,
    })
    .eq("id", job.id)
    .eq("workspace_id", input.workspaceId)
    .eq("status", "FAILED");
  if (updateError) {
    throw new ValidationError(updateError.message);
  }

  if (job.postId) {
    await refreshPostRollup(input.workspaceId, job.postId);
  }

  const profile = await requireProfile();
  await logActivity({
    workspaceId: input.workspaceId,
    userId: profile.id,
    action: "JOB_RETRIED",
    socialAccountId: job.socialAccountId,
    entityType: "job",
    entityId: job.id,
    metadata: { type: job.type },
  });
}

export async function cancelQueuedJob(input: {
  workspaceId: string;
  jobId: string;
}): Promise<void> {
  const context = await requireWorkspaceContext(input.workspaceId);
  assertCanMutateWorkspaceData(context.role);
  const jobId = jobIdSchema.parse(input.jobId);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .select(JOB_PUBLIC_COLUMNS)
    .eq("id", jobId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();

  if (error) {
    throw new ValidationError(error.message);
  }
  if (!data) {
    throw new ValidationError("Job not found");
  }

  const job = toJob(data);
  const stale = isStaleRunningJob(job.status, job.lockedAt);
  if (!canCancelJob(job.status) && !stale) {
    throw new ValidationError("Only PENDING, RETRY, or stale RUNNING jobs can be cancelled");
  }

  const staleThreshold = new Date(Date.now() - STALE_RUNNING_JOB_MS).toISOString();
  const cancelQuery = supabase
    .from("jobs")
    .update({
      status: "CANCELLED",
      locked_at: null,
      locked_by: null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", job.id)
    .eq("workspace_id", input.workspaceId);
  const { error: updateError } = await (
    stale
      ? cancelQuery.eq("status", "RUNNING").lt("locked_at", staleThreshold)
      : cancelQuery.in("status", ["PENDING", "RETRY"])
  );
  if (updateError) {
    throw new ValidationError(updateError.message);
  }

  const profile = await requireProfile();
  await logActivity({
    workspaceId: input.workspaceId,
    userId: profile.id,
    action: "JOB_CANCELLED",
    socialAccountId: job.socialAccountId,
    entityType: "job",
    entityId: job.id,
    metadata: { type: job.type, stale },
  });
}

async function loadJobParents(
  workspaceId: string,
  job: ReturnType<typeof toJob>,
): Promise<{
  campaignStatus: CampaignStatus | null;
  postStatus: PostStatus | null;
  postTargetStatus: PostTargetStatus | null;
  monitoringRuleStatus: MonitoringRuleStatus | null;
}> {
  const supabase = await createClient();
  const [campaignResult, postResult, targetResult, ruleResult] = await Promise.all([
    job.campaignId
      ? supabase
          .from("campaigns")
          .select(CAMPAIGN_PUBLIC_COLUMNS)
          .eq("id", job.campaignId)
          .eq("workspace_id", workspaceId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    job.postId
      ? supabase
          .from("posts")
          .select(POST_PUBLIC_COLUMNS)
          .eq("id", job.postId)
          .eq("workspace_id", workspaceId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    job.postTargetId
      ? supabase
          .from("post_targets")
          .select(POST_TARGET_PUBLIC_COLUMNS)
          .eq("id", job.postTargetId)
          .eq("workspace_id", workspaceId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    job.monitoringRuleId
      ? supabase
          .from("monitoring_rules")
          .select(MONITORING_RULE_PUBLIC_COLUMNS)
          .eq("id", job.monitoringRuleId)
          .eq("workspace_id", workspaceId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const queryError = campaignResult.error ?? postResult.error ?? targetResult.error ?? ruleResult.error;
  if (queryError) {
    throw new ValidationError(queryError.message);
  }

  return {
    campaignStatus: campaignResult.data ? (campaignResult.data.status as CampaignStatus) : null,
    postStatus: postResult.data ? (postResult.data.status as PostStatus) : null,
    postTargetStatus: targetResult.data ? (targetResult.data.status as PostTargetStatus) : null,
    monitoringRuleStatus: ruleResult.data ? (ruleResult.data.status as MonitoringRuleStatus) : null,
  };
}

function retryBlockedMessage(type: ReturnType<typeof toJob>["type"], status: ReturnType<typeof toJob>["status"]): string {
  if (status !== "FAILED") {
    return "Only FAILED jobs can be retried";
  }
  if (type === "CONTACT") {
    return "Contact jobs can be retried only while the campaign is RUNNING";
  }
  if (type === "PUBLISH") {
    return "Publish jobs can be retried only when the post and target are still open";
  }
  if (type === "MONITOR") {
    return "Monitor jobs can be retried only while the rule is ACTIVE";
  }
  return "This job cannot be retried";
}
