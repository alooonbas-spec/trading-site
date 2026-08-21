import { createClient } from "@/lib/supabase/server";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { assertCanMutateWorkspaceData } from "@/lib/auth/permissions";
import {
  AuthenticationError,
  DoNotContactError,
  NetworkError,
  RateLimitError,
  SocialAccountUnavailableError,
  UnsupportedActionError,
  ValidationError,
  errorMessage,
  isAppError,
} from "@/lib/errors";
import { AccountRateLimiter } from "@/lib/jobs/account-rate-limiter";
import { isAdapterContactAction, jobStatusAfterError } from "@/lib/jobs/queue-rules";
import { deriveTokenStatus, isAccountOperable } from "@/lib/social/account-health";
import { decryptSecret, getTokenEncryptionKey } from "@/lib/crypto/token-encryption";
import { assertCanContactLead } from "@/services/leads/do-not-contact";
import { recordLeadInteraction } from "@/services/leads/interaction-service";
import { logActivity } from "@/services/activity/activity-service";
import { getSocialAdapter } from "@/social/core/registry";
import { CAMPAIGN_PUBLIC_COLUMNS, JOB_PUBLIC_COLUMNS, type Job } from "@/types/campaign";
import { LEAD_PUBLIC_COLUMNS } from "@/types/crm";
import { SOCIAL_ACCOUNT_PUBLIC_COLUMNS } from "@/types/social-account";
import { toJob } from "@/services/campaigns/mapper";
import { refreshPostRollup } from "@/services/posts/post-service";
import { POST_PUBLIC_COLUMNS, POST_TARGET_PUBLIC_COLUMNS } from "@/types/post";
import type { ContactStatus } from "@/types/status";

export async function listCampaignJobs(workspaceId: string, campaignId: string): Promise<Job[]> {
  await requireWorkspaceContext(workspaceId);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .select(JOB_PUBLIC_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new ValidationError(error.message);
  }

  return (data ?? []).map(toJob);
}

export async function listPostJobs(workspaceId: string, postId: string): Promise<Job[]> {
  await requireWorkspaceContext(workspaceId);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .select(JOB_PUBLIC_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("post_id", postId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new ValidationError(error.message);
  }

  return (data ?? []).map(toJob);
}

export async function countQueuedJobs(workspaceId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .in("status", ["PENDING", "RETRY", "RUNNING"]);
  if (error) {
    throw new Error(error.message);
  }
  return count ?? 0;
}

export async function countSuccessfulContactJobsToday(workspaceId: string): Promise<number> {
  const supabase = await createClient();
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const { count, error } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("type", "CONTACT")
    .eq("status", "SUCCESS")
    .gte("completed_at", startOfDay.toISOString());
  if (error) {
    throw new Error(error.message);
  }
  return count ?? 0;
}

export async function countJobsByAccount(
  workspaceId: string,
  accountIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (accountIds.length === 0) {
    return counts;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .select("social_account_id")
    .eq("workspace_id", workspaceId)
    .in("social_account_id", accountIds)
    .in("status", ["PENDING", "RETRY", "RUNNING"]);
  if (error) {
    throw new ValidationError(error.message);
  }

  for (const row of data ?? []) {
    counts.set(row.social_account_id, (counts.get(row.social_account_id) ?? 0) + 1);
  }
  return counts;
}

export async function processJobBatch(input: {
  workspaceId: string;
  limit?: number;
}): Promise<{ claimed: number; processed: number }> {
  const context = await requireWorkspaceContext(input.workspaceId);
  assertCanMutateWorkspaceData(context.role);

  const supabase = await createClient();
  const { data: claimed, error } = await supabase.rpc("claim_jobs", {
    p_workspace_id: input.workspaceId,
    p_limit: input.limit ?? 10,
    p_worker_id: `user:${context.user.id}`,
  });

  if (error) {
    throw new ValidationError(error.message);
  }

  const jobs = claimed ?? [];
  for (const row of jobs) {
    await processClaimedJob(toJob(row), context.user.id);
  }

  return { claimed: jobs.length, processed: jobs.length };
}

async function processClaimedJob(job: Job, userId: string): Promise<void> {
  if (job.type === "PUBLISH") {
    await processPublishJob(job, userId);
    return;
  }

  await processContactJob(job, userId);
}

async function processContactJob(job: Job, userId: string): Promise<void> {
  const supabase = await createClient();
  if (!job.leadId || !job.action) {
    throw new ValidationError("Contact job is missing a lead or action");
  }
  const action = job.action;
  const leadId = job.leadId;

  try {
    if (job.campaignId) {
      const { data: campaign } = await supabase
        .from("campaigns")
        .select(CAMPAIGN_PUBLIC_COLUMNS)
        .eq("id", job.campaignId)
        .maybeSingle();
      if (!campaign || campaign.status !== "RUNNING") {
        await supabase
          .from("jobs")
          .update({ status: "PENDING", locked_at: null, locked_by: null })
          .eq("id", job.id);
        return;
      }
    }

    const { data: lead } = await supabase
      .from("leads")
      .select(LEAD_PUBLIC_COLUMNS)
      .eq("id", leadId)
      .maybeSingle();
    if (!lead) {
      throw new ValidationError("Lead not found");
    }
    assertCanContactLead({ do_not_contact: lead.do_not_contact });

    const { data: account } = await supabase
      .from("social_accounts")
      .select(SOCIAL_ACCOUNT_PUBLIC_COLUMNS)
      .eq("id", job.socialAccountId)
      .maybeSingle();
    if (
      !account ||
      !isAccountOperable(account.status) ||
      deriveTokenStatus({ status: account.status, tokenExpiresAt: account.token_expires_at }) !== "CONNECTED"
    ) {
      throw new SocialAccountUnavailableError();
    }

    if (!job.socialProfileId) {
      throw new ValidationError("Job is missing a social profile");
    }

    if (isAdapterContactAction(action)) {
      await markRelationship(job, action === "INVITE" ? "INVITE_PENDING" : "MESSAGE_PENDING");
      const { data: secrets, error: secretError } = await supabase.rpc("read_social_account_secrets", {
        p_account_id: job.socialAccountId,
      });
      const secret = secrets?.[0];
      if (secretError || !secret?.access_token_encrypted) {
        throw new SocialAccountUnavailableError("Social account has no access token");
      }

      const adapter = getSocialAdapter(account.platform, {
        accessToken: decryptSecret(secret.access_token_encrypted, getTokenEncryptionKey()),
        metadata: secret.metadata,
      });
      const limiter = new AccountRateLimiter(async ({ accountId, windowStart, maxActions }) => {
        const { data, error: rateError } = await supabase.rpc("increment_account_rate_bucket", {
          p_account_id: accountId,
          p_window_start: windowStart,
          p_max: maxActions,
        });
        if (rateError) {
          throw new ValidationError(rateError.message);
        }
        return data ?? 0;
      });
      await limiter.take(job.socialAccountId, adapter.getRateLimit());

      const result = await adapter.executeContactAction({
        workspaceId: job.workspaceId,
        socialAccountId: job.socialAccountId,
        socialProfileId: job.socialProfileId,
        leadId,
        action,
        body: job.body ?? undefined,
      });

      await finishJob(job, userId, {
        status: "SUCCESS",
        relationshipStatus: action === "INVITE" ? "INVITE_SENT" : "MESSAGE_SENT",
        result: { status: result.status, externalMessageId: result.externalMessageId },
        activity: "CONTACT_ACTION_SUCCESS",
      });
      return;
    }

    await recordLeadInteraction({
      workspaceId: job.workspaceId,
      leadId,
      userId,
      type: "NOTE",
      socialProfileId: job.socialProfileId,
      socialAccountId: job.socialAccountId,
      relationshipId: job.relationshipId,
      body:
        action === "OPEN_PROFILE"
          ? "Open-profile job recorded. No automated contact was sent."
          : "Manual action required. No automated contact was sent.",
      metadata: { jobId: job.id, action },
    });
    await finishJob(job, userId, {
      status: "SUCCESS",
      result: { status: action },
      activity: "CONTACT_ACTION_SUCCESS",
    });
  } catch (caught) {
    await failOrRetry(job, userId, caught);
  }
}

async function processPublishJob(job: Job, userId: string): Promise<void> {
  const supabase = await createClient();

  try {
    if (!job.postId || !job.postTargetId) {
      throw new ValidationError("Publish job is missing a post target");
    }

    const { data: post } = await supabase
      .from("posts")
      .select(POST_PUBLIC_COLUMNS)
      .eq("id", job.postId)
      .maybeSingle();
    if (!post || post.status === "CANCELLED") {
      await supabase
        .from("jobs")
        .update({
          status: "CANCELLED",
          locked_at: null,
          locked_by: null,
          completed_at: new Date().toISOString(),
          last_error: "Post was cancelled",
        })
        .eq("id", job.id);
      return;
    }

    const { data: target } = await supabase
      .from("post_targets")
      .select(POST_TARGET_PUBLIC_COLUMNS)
      .eq("id", job.postTargetId)
      .maybeSingle();
    if (!target || target.status === "CANCELLED") {
      await supabase
        .from("jobs")
        .update({
          status: "CANCELLED",
          locked_at: null,
          locked_by: null,
          completed_at: new Date().toISOString(),
          last_error: "Post target was cancelled",
        })
        .eq("id", job.id);
      return;
    }

    if (target.status === "PUBLISHED" && target.external_post_id) {
      await finishJob(job, userId, {
        status: "SUCCESS",
        result: { externalPostId: target.external_post_id },
        activity: "POST_PUBLISHED",
      });
      return;
    }

    const { data: account } = await supabase
      .from("social_accounts")
      .select(SOCIAL_ACCOUNT_PUBLIC_COLUMNS)
      .eq("id", job.socialAccountId)
      .maybeSingle();
    if (
      !account ||
      !isAccountOperable(account.status) ||
      deriveTokenStatus({ status: account.status, tokenExpiresAt: account.token_expires_at }) !== "CONNECTED"
    ) {
      throw new SocialAccountUnavailableError();
    }

    await supabase
      .from("post_targets")
      .update({ status: "PUBLISHING", last_error: null })
      .eq("id", target.id);

    const { data: secrets, error: secretError } = await supabase.rpc("read_social_account_secrets", {
      p_account_id: job.socialAccountId,
    });
    const secret = secrets?.[0];
    if (secretError || !secret?.access_token_encrypted) {
      throw new SocialAccountUnavailableError("Social account has no access token");
    }

    const adapter = getSocialAdapter(account.platform, {
      accessToken: decryptSecret(secret.access_token_encrypted, getTokenEncryptionKey()),
      metadata: secret.metadata,
    });
    const capabilities = await adapter.getCapabilities();
    if (!capabilities.publishing) {
      throw new UnsupportedActionError(`${account.platform} publishing is not enabled yet`);
    }

    const limiter = new AccountRateLimiter(async ({ accountId, windowStart, maxActions }) => {
      const { data, error: rateError } = await supabase.rpc("increment_account_rate_bucket", {
        p_account_id: accountId,
        p_window_start: windowStart,
        p_max: maxActions,
      });
      if (rateError) {
        throw new ValidationError(rateError.message);
      }
      return data ?? 0;
    });
    await limiter.take(job.socialAccountId, adapter.getRateLimit());

    const media = Array.isArray(post.media)
      ? post.media.filter((item): item is string => typeof item === "string")
      : [];
    const result = await adapter.publish({
      workspaceId: job.workspaceId,
      socialAccountId: job.socialAccountId,
      body: post.body,
      media,
    });

    await supabase
      .from("post_targets")
      .update({
        status: "PUBLISHED",
        external_post_id: result.externalPostId,
        published_at: result.publishedAt,
        last_error: null,
      })
      .eq("id", target.id);

    await finishJob(job, userId, {
      status: "SUCCESS",
      result: { externalPostId: result.externalPostId },
      activity: "POST_PUBLISHED",
    });
  } catch (caught) {
    await failOrRetry(job, userId, caught);
  }
}

async function markRelationship(job: Job, status: ContactStatus): Promise<void> {
  if (!job.relationshipId) {
    return;
  }
  const supabase = await createClient();
  await supabase
    .from("contact_relationships")
    .update({ status, last_interacted_at: new Date().toISOString() })
    .eq("id", job.relationshipId);
}

async function finishJob(
  job: Job,
  userId: string,
  input: {
    status: "SUCCESS" | "FAILED";
    relationshipStatus?: ContactStatus;
    result: Record<string, unknown>;
    activity: "CONTACT_ACTION_SUCCESS" | "CONTACT_ACTION_FAILED" | "POST_PUBLISHED" | "POST_FAILED";
    error?: string;
  },
): Promise<void> {
  const supabase = await createClient();
  if (input.relationshipStatus) {
    await markRelationship(job, input.relationshipStatus);
  }

  await supabase
    .from("jobs")
    .update({
      status: input.status,
      result: input.result,
      last_error: input.error ?? null,
      locked_at: null,
      locked_by: null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  if (job.postTargetId && input.status === "FAILED") {
    await supabase
      .from("post_targets")
      .update({ status: "FAILED", last_error: input.error ?? "Publish failed" })
      .eq("id", job.postTargetId)
      .neq("status", "PUBLISHED");
  }

  await logActivity({
    workspaceId: job.workspaceId,
    userId,
    action: input.activity,
    socialAccountId: job.socialAccountId,
    entityType: "job",
    entityId: job.id,
  });

  if (job.campaignId) {
    await maybeCompleteCampaign(job.workspaceId, job.campaignId);
  }
  if (job.postId) {
    await refreshPostRollup(job.workspaceId, job.postId);
  }
}

async function failOrRetry(job: Job, userId: string, caught: unknown): Promise<void> {
  const retryable =
    caught instanceof NetworkError ||
    caught instanceof RateLimitError ||
    caught instanceof AuthenticationError;
  const outcome = jobStatusAfterError({
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    retryable,
  });
  const message = errorMessage(caught);

  if (caught instanceof DoNotContactError || outcome.status === "FAILED") {
    await finishJob(job, userId, {
      status: "FAILED",
      relationshipStatus:
        job.type === "CONTACT" &&
        (caught instanceof UnsupportedActionError ||
          caught instanceof DoNotContactError ||
          caught instanceof SocialAccountUnavailableError)
          ? "FAILED"
          : undefined,
      result: { error: isAppError(caught) ? caught.code : "INTERNAL" },
      activity: job.type === "PUBLISH" ? "POST_FAILED" : "CONTACT_ACTION_FAILED",
      error: message,
    });
    return;
  }

  const supabase = await createClient();
  if (job.postTargetId) {
    await supabase
      .from("post_targets")
      .update({ status: "PENDING", last_error: message })
      .eq("id", job.postTargetId)
      .neq("status", "PUBLISHED");
  }
  await supabase
    .from("jobs")
    .update({
      status: "RETRY",
      last_error: message,
      run_after: outcome.runAfter?.toISOString() ?? new Date().toISOString(),
      locked_at: null,
      locked_by: null,
    })
    .eq("id", job.id);
}

async function maybeCompleteCampaign(workspaceId: string, campaignId: string): Promise<void> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .in("status", ["PENDING", "RETRY", "RUNNING"]);
  if (error || (count ?? 0) > 0) {
    return;
  }

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("status")
    .eq("id", campaignId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (campaign?.status !== "RUNNING") {
    return;
  }

  await supabase
    .from("campaigns")
    .update({ status: "COMPLETED", completed_at: new Date().toISOString() })
    .eq("id", campaignId);
}
