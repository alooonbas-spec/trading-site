import { createClient } from "@/lib/supabase/server";
import { ValidationError } from "@/lib/errors";
import { buildEnqueuePairs } from "@/lib/jobs/queue-rules";
import { deriveTokenStatus, isAccountOperable } from "@/lib/social/account-health";
import { logActivity } from "@/services/activity/activity-service";
import { CAMPAIGN_PUBLIC_COLUMNS, JOB_PUBLIC_COLUMNS } from "@/types/campaign";
import { LEAD_PUBLIC_COLUMNS } from "@/types/crm";
import { SOCIAL_ACCOUNT_PUBLIC_COLUMNS } from "@/types/social-account";
import { SOCIAL_PROFILE_PUBLIC_COLUMNS } from "@/types/crm";
import { CONTACT_RELATIONSHIP_PUBLIC_COLUMNS } from "@/types/crm";

export async function enqueueCampaignJobs(input: {
  workspaceId: string;
  campaignId: string;
  userId: string;
}): Promise<number> {
  const supabase = await createClient();
  const { data: campaign, error: campaignError } = await supabase
    .from("campaigns")
    .select(CAMPAIGN_PUBLIC_COLUMNS)
    .eq("id", input.campaignId)
    .eq("workspace_id", input.workspaceId)
    .single();

  if (campaignError || !campaign) {
    throw new ValidationError(campaignError?.message ?? "Campaign not found");
  }

  const [{ data: campaignLeads, error: leadLinkError }, { data: campaignAccounts, error: accountLinkError }] =
    await Promise.all([
      supabase.from("campaign_leads").select("lead_id").eq("campaign_id", input.campaignId),
      supabase.from("campaign_accounts").select("social_account_id").eq("campaign_id", input.campaignId),
    ]);

  if (leadLinkError) {
    throw new ValidationError(leadLinkError.message);
  }
  if (accountLinkError) {
    throw new ValidationError(accountLinkError.message);
  }

  const leadIds = (campaignLeads ?? []).map((row) => row.lead_id);
  const accountIds = (campaignAccounts ?? []).map((row) => row.social_account_id);
  if (leadIds.length === 0 || accountIds.length === 0) {
    throw new ValidationError("Campaign needs at least one lead and one social account");
  }

  const [{ data: leads, error: leadError }, { data: accounts, error: accountError }, { data: profiles, error: profileError }] =
    await Promise.all([
      supabase.from("leads").select(LEAD_PUBLIC_COLUMNS).eq("workspace_id", input.workspaceId).in("id", leadIds),
      supabase
        .from("social_accounts")
        .select(SOCIAL_ACCOUNT_PUBLIC_COLUMNS)
        .eq("workspace_id", input.workspaceId)
        .in("id", accountIds),
      supabase
        .from("social_profiles")
        .select(SOCIAL_PROFILE_PUBLIC_COLUMNS)
        .eq("workspace_id", input.workspaceId)
        .in("lead_id", leadIds),
    ]);

  if (leadError) {
    throw new ValidationError(leadError.message);
  }
  if (accountError) {
    throw new ValidationError(accountError.message);
  }
  if (profileError) {
    throw new ValidationError(profileError.message);
  }

  const skippedLeadIds = new Set(
    (leads ?? []).filter((lead) => lead.do_not_contact || lead.merged_into_id).map((lead) => lead.id),
  );
  const operableAccounts = (accounts ?? []).filter(
    (account) =>
      isAccountOperable(account.status) &&
      deriveTokenStatus({ status: account.status, tokenExpiresAt: account.token_expires_at }) === "CONNECTED",
  );

  const pairs = buildEnqueuePairs({
    leadIds,
    skippedLeadIds,
    accounts: operableAccounts.map((account) => ({ id: account.id, platform: account.platform })),
    profiles: (profiles ?? []).map((profile) => ({
      id: profile.id,
      leadId: profile.lead_id,
      platform: profile.platform,
    })),
  });

  if (pairs.length === 0) {
    throw new ValidationError(
      "No jobs to enqueue. Each selected lead needs a social profile on the same platform as a connected campaign account, and must not be do_not_contact.",
    );
  }

  const { data: existingJobs, error: existingError } = await supabase
    .from("jobs")
    .select("lead_id, social_account_id")
    .eq("campaign_id", input.campaignId)
    .in("status", ["PENDING", "RETRY", "RUNNING", "SUCCESS"]);
  if (existingError) {
    throw new ValidationError(existingError.message);
  }
  const existingKeys = new Set(
    (existingJobs ?? []).map((job) => `${job.lead_id}:${job.social_account_id}`),
  );

  const { data: relationships, error: relationshipError } = await supabase
    .from("contact_relationships")
    .select(CONTACT_RELATIONSHIP_PUBLIC_COLUMNS)
    .eq("workspace_id", input.workspaceId)
    .in(
      "social_profile_id",
      pairs.map((pair) => pair.socialProfileId),
    );
  if (relationshipError) {
    throw new ValidationError(relationshipError.message);
  }

  const relationshipKey = (profileId: string, accountId: string) => `${profileId}:${accountId}`;
  const relationshipsByPair = new Map(
    (relationships ?? []).map((row) => [relationshipKey(row.social_profile_id, row.social_account_id), row]),
  );

  const inserts = [];
  for (const pair of pairs) {
    if (existingKeys.has(`${pair.leadId}:${pair.socialAccountId}`)) {
      continue;
    }

    let relationship = relationshipsByPair.get(relationshipKey(pair.socialProfileId, pair.socialAccountId));
    if (!relationship) {
      const { data: created, error: createError } = await supabase
        .from("contact_relationships")
        .insert({
          workspace_id: input.workspaceId,
          lead_id: pair.leadId,
          social_profile_id: pair.socialProfileId,
          social_account_id: pair.socialAccountId,
          status: "NOT_CONTACTED",
        })
        .select(CONTACT_RELATIONSHIP_PUBLIC_COLUMNS)
        .single();
      if (createError || !created) {
        if (createError?.code === "23505") {
          const { data: existing } = await supabase
            .from("contact_relationships")
            .select(CONTACT_RELATIONSHIP_PUBLIC_COLUMNS)
            .eq("social_profile_id", pair.socialProfileId)
            .eq("social_account_id", pair.socialAccountId)
            .single();
          if (!existing) {
            throw new ValidationError(createError.message);
          }
          relationship = existing;
        } else {
          throw new ValidationError(createError?.message ?? "Unable to create contact relationship");
        }
      } else {
        relationship = created;
      }
    }

    inserts.push({
      workspace_id: input.workspaceId,
      campaign_id: input.campaignId,
      social_account_id: pair.socialAccountId,
      lead_id: pair.leadId,
      social_profile_id: pair.socialProfileId,
      relationship_id: relationship.id,
      type: "CONTACT" as const,
      action: campaign.action,
      body: campaign.body,
      status: "PENDING" as const,
    });
  }

  if (inserts.length === 0) {
    return 0;
  }

  const { error: insertError } = await supabase.from("jobs").insert(inserts).select(JOB_PUBLIC_COLUMNS);
  if (insertError) {
    throw new ValidationError(insertError.message);
  }

  await logActivity({
    workspaceId: input.workspaceId,
    userId: input.userId,
    action: "CONTACT_QUEUED",
    entityType: "campaign",
    entityId: input.campaignId,
    metadata: { jobCount: inserts.length },
  });

  return inserts.length;
}

export async function enqueuePublishJobs(input: {
  workspaceId: string;
  postId: string;
  runAfter: string | null;
}): Promise<number> {
  const supabase = await createClient();
  const [{ data: post, error: postError }, { data: targets, error: targetError }] = await Promise.all([
    supabase
      .from("posts")
      .select("id, body")
      .eq("id", input.postId)
      .eq("workspace_id", input.workspaceId)
      .maybeSingle(),
    supabase
      .from("post_targets")
      .select("id, social_account_id, status")
      .eq("post_id", input.postId)
      .eq("workspace_id", input.workspaceId),
  ]);

  if (postError || !post) {
    throw new ValidationError(postError?.message ?? "Post not found");
  }
  if (targetError) {
    throw new ValidationError(targetError.message);
  }

  const readyTargets = (targets ?? []).filter(
    (target) => target.status === "PENDING" || target.status === "SCHEDULED",
  );
  if (readyTargets.length === 0) {
    throw new ValidationError("Post has no targets ready to publish");
  }

  const { data: existingJobs, error: existingError } = await supabase
    .from("jobs")
    .select("post_target_id")
    .eq("post_id", input.postId)
    .in("status", ["PENDING", "RETRY", "RUNNING", "SUCCESS"]);
  if (existingError) {
    throw new ValidationError(existingError.message);
  }
  const existingTargets = new Set((existingJobs ?? []).map((job) => job.post_target_id).filter(Boolean));

  const inserts = readyTargets
    .filter((target) => !existingTargets.has(target.id))
    .map((target) => ({
      workspace_id: input.workspaceId,
      campaign_id: null,
      social_account_id: target.social_account_id,
      lead_id: null,
      social_profile_id: null,
      relationship_id: null,
      post_id: input.postId,
      post_target_id: target.id,
      type: "PUBLISH" as const,
      action: null,
      body: post.body,
      status: "PENDING" as const,
      run_after: input.runAfter ?? new Date().toISOString(),
    }));

  if (inserts.length === 0) {
    return 0;
  }

  const { error: insertError } = await supabase.from("jobs").insert(inserts);
  if (insertError) {
    throw new ValidationError(insertError.message);
  }

  return inserts.length;
}
