import { createClient } from "@/lib/supabase/server";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { assertCanManageWorkspace, assertCanMutateWorkspaceData } from "@/lib/auth/permissions";
import { ValidationError } from "@/lib/errors";
import { logActivity } from "@/services/activity/activity-service";
import { createCampaignSchema } from "@/lib/validation/campaign";
import { canCancelCampaign, canPauseCampaign, canStartCampaign } from "@/lib/jobs/queue-rules";
import { CAMPAIGN_PUBLIC_COLUMNS, type Campaign, type CampaignAction } from "@/types/campaign";
import { emptyToNull } from "@/services/leads/mapper";
import { toCampaign } from "@/services/campaigns/mapper";
import { enqueueCampaignJobs } from "@/services/jobs/enqueue-service";

export async function listCampaigns(workspaceId: string): Promise<Campaign[]> {
  await requireWorkspaceContext(workspaceId);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campaigns")
    .select(CAMPAIGN_PUBLIC_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new ValidationError(error.message);
  }

  return attachCampaignCounts(workspaceId, (data ?? []).map((row) => toCampaign(row)));
}

export async function getCampaign(workspaceId: string, campaignId: string): Promise<Campaign> {
  await requireWorkspaceContext(workspaceId);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campaigns")
    .select(CAMPAIGN_PUBLIC_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("id", campaignId)
    .maybeSingle();

  if (error) {
    throw new ValidationError(error.message);
  }
  if (!data) {
    throw new ValidationError("Campaign not found");
  }

  const [campaign] = await attachCampaignCounts(workspaceId, [toCampaign(data)]);
  if (!campaign) {
    throw new ValidationError("Campaign not found");
  }
  return campaign;
}

export async function countRunningCampaigns(workspaceId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("campaigns")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("status", "RUNNING");

  if (error) {
    throw new Error(error.message);
  }
  return count ?? 0;
}

export async function createCampaign(input: {
  workspaceId: string;
  name: string;
  description?: string;
  action: CampaignAction;
  body?: string;
  leadIds: string[];
  accountIds: string[];
}): Promise<Campaign> {
  const context = await requireWorkspaceContext(input.workspaceId);
  assertCanMutateWorkspaceData(context.role);
  const parsed = createCampaignSchema.parse({
    name: input.name,
    description: input.description,
    action: input.action,
    body: input.body,
    leadIds: input.leadIds,
    accountIds: input.accountIds,
  });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campaigns")
    .insert({
      workspace_id: input.workspaceId,
      name: parsed.name,
      description: emptyToNull(parsed.description),
      action: parsed.action,
      body: emptyToNull(parsed.body),
      created_by: context.user.id,
    })
    .select(CAMPAIGN_PUBLIC_COLUMNS)
    .single();

  if (error || !data) {
    throw new ValidationError(error?.message ?? "Unable to create campaign");
  }

  const { error: leadError } = await supabase.from("campaign_leads").insert(
    parsed.leadIds.map((leadId) => ({
      workspace_id: input.workspaceId,
      campaign_id: data.id,
      lead_id: leadId,
    })),
  );
  if (leadError) {
    throw new ValidationError(leadError.message);
  }

  const { error: accountError } = await supabase.from("campaign_accounts").insert(
    parsed.accountIds.map((accountId) => ({
      workspace_id: input.workspaceId,
      campaign_id: data.id,
      social_account_id: accountId,
    })),
  );
  if (accountError) {
    throw new ValidationError(accountError.message);
  }

  await logActivity({
    workspaceId: input.workspaceId,
    userId: context.user.id,
    action: "CAMPAIGN_CREATED",
    entityType: "campaign",
    entityId: data.id,
  });

  return getCampaign(input.workspaceId, data.id);
}

export async function startCampaign(input: { workspaceId: string; campaignId: string }): Promise<Campaign> {
  const context = await requireWorkspaceContext(input.workspaceId);
  assertCanMutateWorkspaceData(context.role);
  const campaign = await getCampaign(input.workspaceId, input.campaignId);
  if (!canStartCampaign(campaign.status)) {
    throw new ValidationError(`Cannot start a ${campaign.status} campaign`);
  }

  if (campaign.status === "DRAFT") {
    await enqueueCampaignJobs({
      workspaceId: input.workspaceId,
      campaignId: campaign.id,
      userId: context.user.id,
    });
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("campaigns")
    .update({
      status: "RUNNING",
      started_at: campaign.startedAt ?? new Date().toISOString(),
      completed_at: null,
    })
    .eq("id", campaign.id);

  if (error) {
    throw new ValidationError(error.message);
  }

  await logActivity({
    workspaceId: input.workspaceId,
    userId: context.user.id,
    action: "CAMPAIGN_STARTED",
    entityType: "campaign",
    entityId: campaign.id,
  });

  return getCampaign(input.workspaceId, campaign.id);
}

export async function pauseCampaign(input: { workspaceId: string; campaignId: string }): Promise<Campaign> {
  const context = await requireWorkspaceContext(input.workspaceId);
  assertCanMutateWorkspaceData(context.role);
  const campaign = await getCampaign(input.workspaceId, input.campaignId);
  if (!canPauseCampaign(campaign.status)) {
    throw new ValidationError(`Cannot pause a ${campaign.status} campaign`);
  }

  const supabase = await createClient();
  const { error } = await supabase.from("campaigns").update({ status: "PAUSED" }).eq("id", campaign.id);
  if (error) {
    throw new ValidationError(error.message);
  }

  await logActivity({
    workspaceId: input.workspaceId,
    userId: context.user.id,
    action: "CAMPAIGN_PAUSED",
    entityType: "campaign",
    entityId: campaign.id,
  });

  return getCampaign(input.workspaceId, campaign.id);
}

export async function cancelCampaign(input: { workspaceId: string; campaignId: string }): Promise<Campaign> {
  const context = await requireWorkspaceContext(input.workspaceId);
  assertCanMutateWorkspaceData(context.role);
  const campaign = await getCampaign(input.workspaceId, input.campaignId);
  if (!canCancelCampaign(campaign.status)) {
    throw new ValidationError(`Cannot cancel a ${campaign.status} campaign`);
  }

  const supabase = await createClient();
  const { error: jobError } = await supabase
    .from("jobs")
    .update({ status: "CANCELLED", completed_at: new Date().toISOString() })
    .eq("campaign_id", campaign.id)
    .in("status", ["PENDING", "RETRY"]);
  if (jobError) {
    throw new ValidationError(jobError.message);
  }

  const { error } = await supabase
    .from("campaigns")
    .update({ status: "CANCELLED", completed_at: new Date().toISOString() })
    .eq("id", campaign.id);
  if (error) {
    throw new ValidationError(error.message);
  }

  return getCampaign(input.workspaceId, campaign.id);
}

export async function deleteCampaign(input: { workspaceId: string; campaignId: string }): Promise<void> {
  const context = await requireWorkspaceContext(input.workspaceId);
  assertCanManageWorkspace(context.role);
  const campaign = await getCampaign(input.workspaceId, input.campaignId);
  if (campaign.status === "RUNNING") {
    throw new ValidationError("Pause or cancel the campaign before deleting it");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("campaigns")
    .delete()
    .eq("id", input.campaignId)
    .eq("workspace_id", input.workspaceId);
  if (error) {
    throw new ValidationError(error.message);
  }
}

async function attachCampaignCounts(workspaceId: string, campaigns: Campaign[]): Promise<Campaign[]> {
  if (campaigns.length === 0) {
    return campaigns;
  }

  const supabase = await createClient();
  const ids = campaigns.map((campaign) => campaign.id);
  const [{ data: leads }, { data: accounts }, { data: jobs }] = await Promise.all([
    supabase.from("campaign_leads").select("campaign_id").eq("workspace_id", workspaceId).in("campaign_id", ids),
    supabase.from("campaign_accounts").select("campaign_id").eq("workspace_id", workspaceId).in("campaign_id", ids),
    supabase
      .from("jobs")
      .select("campaign_id, status")
      .eq("workspace_id", workspaceId)
      .in("campaign_id", ids)
      .in("status", ["PENDING", "RETRY", "RUNNING"]),
  ]);

  return campaigns.map((campaign) => ({
    ...campaign,
    leadCount: (leads ?? []).filter((row) => row.campaign_id === campaign.id).length,
    accountCount: (accounts ?? []).filter((row) => row.campaign_id === campaign.id).length,
    pendingJobCount: (jobs ?? []).filter((row) => row.campaign_id === campaign.id).length,
  }));
}

export async function listCampaignLeadIds(workspaceId: string, campaignId: string): Promise<string[]> {
  await requireWorkspaceContext(workspaceId);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campaign_leads")
    .select("lead_id")
    .eq("workspace_id", workspaceId)
    .eq("campaign_id", campaignId);
  if (error) {
    throw new ValidationError(error.message);
  }
  return (data ?? []).map((row) => row.lead_id);
}

export async function listCampaignAccountIds(workspaceId: string, campaignId: string): Promise<string[]> {
  await requireWorkspaceContext(workspaceId);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campaign_accounts")
    .select("social_account_id")
    .eq("workspace_id", workspaceId)
    .eq("campaign_id", campaignId);
  if (error) {
    throw new ValidationError(error.message);
  }
  return (data ?? []).map((row) => row.social_account_id);
}
