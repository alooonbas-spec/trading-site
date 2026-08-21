import { createClient } from "@/lib/supabase/server";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { ValidationError } from "@/lib/errors";
import { canCancelJob, canRetryFailedJob } from "@/lib/jobs/status";
import {
  DEFAULT_PAGE_SIZE,
  keysetOrFilter,
  nextKeysetCursor,
  parseKeysetCursor,
  splitKeysetRows,
  type KeysetPage,
} from "@/lib/pagination/keyset";
import { toJob } from "@/services/campaigns/mapper";
import { CAMPAIGN_PUBLIC_COLUMNS, JOB_PUBLIC_COLUMNS, type JobListItem, type JobType } from "@/types/campaign";
import { LEAD_PUBLIC_COLUMNS } from "@/types/crm";
import { MONITORING_RULE_PUBLIC_COLUMNS } from "@/types/monitoring";
import { POST_PUBLIC_COLUMNS, POST_TARGET_PUBLIC_COLUMNS } from "@/types/post";
import { SOCIAL_ACCOUNT_PUBLIC_COLUMNS } from "@/types/social-account";
import type { CampaignStatus, JobStatus, MonitoringRuleStatus, PostStatus, PostTargetStatus } from "@/types/status";
import type { SocialPlatform } from "@/types/social";

const JOB_PAGE_SIZE = DEFAULT_PAGE_SIZE;

export async function listWorkspaceJobs(input: {
  workspaceId: string;
  type?: JobType;
  status?: JobStatus;
  socialAccountId?: string;
  after?: string;
}): Promise<KeysetPage<JobListItem>> {
  await requireWorkspaceContext(input.workspaceId);
  const supabase = await createClient();
  const cursor = parseKeysetCursor(input.after);
  let request = supabase
    .from("jobs")
    .select(JOB_PUBLIC_COLUMNS)
    .eq("workspace_id", input.workspaceId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(JOB_PAGE_SIZE + 1);
  if (cursor) {
    request = request.or(keysetOrFilter(cursor));
  }

  if (input.type) {
    request = request.eq("type", input.type);
  }
  if (input.status) {
    request = request.eq("status", input.status);
  }
  if (input.socialAccountId) {
    request = request.eq("social_account_id", input.socialAccountId);
  }

  const { data, error } = await request;
  if (error) {
    throw new ValidationError(error.message);
  }

  const rows = data ?? [];
  const { page, hasMore } = splitKeysetRows(rows, JOB_PAGE_SIZE);
  if (page.length === 0) {
    return { items: [], nextCursor: null };
  }

  const accountIds = [...new Set(page.map((row) => row.social_account_id).filter((id): id is string => id !== null))];
  const leadIds = [...new Set(page.map((row) => row.lead_id).filter((id): id is string => id !== null))];
  const campaignIds = [...new Set(page.map((row) => row.campaign_id).filter((id): id is string => id !== null))];
  const postIds = [...new Set(page.map((row) => row.post_id).filter((id): id is string => id !== null))];
  const postTargetIds = [...new Set(page.map((row) => row.post_target_id).filter((id): id is string => id !== null))];
  const ruleIds = [
    ...new Set(page.map((row) => row.monitoring_rule_id).filter((id): id is string => id !== null)),
  ];

  const [
    { data: accounts, error: accountError },
    { data: leads, error: leadError },
    { data: campaigns, error: campaignError },
    { data: posts, error: postError },
    { data: targets, error: targetError },
    { data: rules, error: ruleError },
  ] = await Promise.all([
    accountIds.length > 0
      ? supabase
          .from("social_accounts")
          .select(SOCIAL_ACCOUNT_PUBLIC_COLUMNS)
          .eq("workspace_id", input.workspaceId)
          .in("id", accountIds)
      : Promise.resolve({ data: [], error: null }),
    leadIds.length > 0
      ? supabase.from("leads").select(LEAD_PUBLIC_COLUMNS).eq("workspace_id", input.workspaceId).in("id", leadIds)
      : Promise.resolve({ data: [], error: null }),
    campaignIds.length > 0
      ? supabase
          .from("campaigns")
          .select(CAMPAIGN_PUBLIC_COLUMNS)
          .eq("workspace_id", input.workspaceId)
          .in("id", campaignIds)
      : Promise.resolve({ data: [], error: null }),
    postIds.length > 0
      ? supabase.from("posts").select(POST_PUBLIC_COLUMNS).eq("workspace_id", input.workspaceId).in("id", postIds)
      : Promise.resolve({ data: [], error: null }),
    postTargetIds.length > 0
      ? supabase
          .from("post_targets")
          .select(POST_TARGET_PUBLIC_COLUMNS)
          .eq("workspace_id", input.workspaceId)
          .in("id", postTargetIds)
      : Promise.resolve({ data: [], error: null }),
    ruleIds.length > 0
      ? supabase
          .from("monitoring_rules")
          .select(MONITORING_RULE_PUBLIC_COLUMNS)
          .eq("workspace_id", input.workspaceId)
          .in("id", ruleIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const queryError = accountError ?? leadError ?? campaignError ?? postError ?? targetError ?? ruleError;
  if (queryError) {
    throw new ValidationError(queryError.message);
  }

  const accountsById = new Map(
    (accounts ?? []).map((account) => [
      account.id,
      {
        platform: account.platform as SocialPlatform,
        username: account.username,
        displayName: account.display_name,
      },
    ]),
  );
  const leadsById = new Map((leads ?? []).map((lead) => [lead.id, lead.display_name]));
  const campaignsById = new Map(
    (campaigns ?? []).map((campaign) => [campaign.id, { name: campaign.name, status: campaign.status as CampaignStatus }]),
  );
  const postsById = new Map(
    (posts ?? []).map((post) => [
      post.id,
      { excerpt: post.body.slice(0, 80), status: post.status as PostStatus },
    ]),
  );
  const targetsById = new Map(
    (targets ?? []).map((target) => [target.id, target.status as PostTargetStatus]),
  );
  const rulesById = new Map(
    (rules ?? []).map((rule) => [
      rule.id,
      { name: rule.name, status: rule.status as MonitoringRuleStatus },
    ]),
  );

  const items = page.map((row) => {
    const job = toJob(row);
    const account = job.socialAccountId ? accountsById.get(job.socialAccountId) : undefined;
    const campaign = job.campaignId ? campaignsById.get(job.campaignId) : undefined;
    const post = job.postId ? postsById.get(job.postId) : undefined;
    const rule = job.monitoringRuleId ? rulesById.get(job.monitoringRuleId) : undefined;
    return {
      ...job,
      platform: account?.platform ?? null,
      accountUsername: account?.username ?? null,
      accountDisplayName: account?.displayName ?? null,
      leadDisplayName: job.leadId ? (leadsById.get(job.leadId) ?? null) : null,
      campaignName: campaign?.name ?? null,
      postExcerpt: post?.excerpt ?? null,
      monitoringRuleName: rule?.name ?? null,
      canRetry: canRetryFailedJob({
        jobStatus: job.status,
        jobType: job.type,
        campaignStatus: campaign?.status ?? null,
        postStatus: post?.status ?? null,
        postTargetStatus: job.postTargetId ? (targetsById.get(job.postTargetId) ?? null) : null,
        monitoringRuleStatus: rule?.status ?? null,
      }),
      canCancel: canCancelJob(job.status),
    };
  });
  return {
    items,
    nextCursor: nextKeysetCursor(page, hasMore),
  };
}
