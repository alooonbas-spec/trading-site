import { createClient } from "@/lib/supabase/server";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { ValidationError } from "@/lib/errors";
import { statusCount, tallyByStatus } from "@/lib/analytics/tally";
import { daysAgoUtc, startOfUtcDay } from "@/lib/analytics/window";
import type { JobType } from "@/types/campaign";
import type { WorkspaceAnalytics } from "@/types/analytics";
import {
  CAMPAIGN_STATUSES,
  CONTACT_STATUSES,
  JOB_STATUSES,
  LEAD_STATUSES,
  MONITORING_RULE_STATUSES,
  POST_STATUSES,
  SOCIAL_ACCOUNT_STATUSES,
  type CampaignStatus,
  type ContactStatus,
  type JobStatus,
  type LeadStatus,
  type MonitoringRuleStatus,
  type PostStatus,
  type SocialAccountStatus,
} from "@/types/status";

function isLeadStatus(value: string): value is LeadStatus {
  return (LEAD_STATUSES as readonly string[]).includes(value);
}

function isContactStatus(value: string): value is ContactStatus {
  return (CONTACT_STATUSES as readonly string[]).includes(value);
}

function isCampaignStatus(value: string): value is CampaignStatus {
  return (CAMPAIGN_STATUSES as readonly string[]).includes(value);
}

function isSocialAccountStatus(value: string): value is SocialAccountStatus {
  return (SOCIAL_ACCOUNT_STATUSES as readonly string[]).includes(value);
}

function isPostStatus(value: string): value is PostStatus {
  return (POST_STATUSES as readonly string[]).includes(value);
}

function isMonitoringRuleStatus(value: string): value is MonitoringRuleStatus {
  return (MONITORING_RULE_STATUSES as readonly string[]).includes(value);
}

function isJobStatus(value: string): value is JobStatus {
  return (JOB_STATUSES as readonly string[]).includes(value);
}

function isJobType(value: string): value is JobType {
  return value === "CONTACT" || value === "PUBLISH" || value === "MONITOR" || value === "INBOX";
}

export async function getWorkspaceAnalytics(workspaceId: string): Promise<WorkspaceAnalytics> {
  await requireWorkspaceContext(workspaceId);
  const supabase = await createClient();
  const today = startOfUtcDay().toISOString();
  const last7Days = daysAgoUtc(6).toISOString();

  const [
    leadsResult,
    relationshipsResult,
    campaignsResult,
    accountsResult,
    postsResult,
    rulesResult,
    eventsTodayResult,
    eventsWeekResult,
    jobsResult,
    contactSuccessToday,
    contactFailedToday,
    postsPublishedToday,
    inboxTodayResult,
    inboxMatchedTodayResult,
    inboxUnmatchedResult,
    inboxRepliesTodayResult,
  ] = await Promise.all([
    supabase
      .from("leads")
      .select("status, do_not_contact, merged_into_id, created_at")
      .eq("workspace_id", workspaceId),
    supabase.from("contact_relationships").select("status").eq("workspace_id", workspaceId),
    supabase.from("campaigns").select("status").eq("workspace_id", workspaceId),
    supabase.from("social_accounts").select("status").eq("workspace_id", workspaceId),
    supabase.from("posts").select("status").eq("workspace_id", workspaceId),
    supabase.from("monitoring_rules").select("status").eq("workspace_id", workspaceId),
    supabase
      .from("monitoring_events")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .gte("created_at", today),
    supabase
      .from("monitoring_events")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .gte("created_at", last7Days),
    supabase.from("jobs").select("type, status").eq("workspace_id", workspaceId),
    supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("type", "CONTACT")
      .eq("status", "SUCCESS")
      .gte("completed_at", today),
    supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("type", "CONTACT")
      .eq("status", "FAILED")
      .gte("completed_at", today),
    supabase
      .from("posts")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .in("status", ["PUBLISHED", "PARTIAL"])
      .gte("published_at", today),
    supabase
      .from("inbox_events")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .gte("created_at", today),
    supabase
      .from("inbox_events")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("matched", true)
      .gte("created_at", today),
    supabase
      .from("inbox_events")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("matched", false),
    supabase
      .from("activity_log")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("action", "INBOX_REPLIED")
      .gte("created_at", today),
  ]);

  const queryError =
    leadsResult.error ??
    relationshipsResult.error ??
    campaignsResult.error ??
    accountsResult.error ??
    postsResult.error ??
    rulesResult.error ??
    eventsTodayResult.error ??
    eventsWeekResult.error ??
    jobsResult.error ??
    contactSuccessToday.error ??
    contactFailedToday.error ??
    postsPublishedToday.error ??
    inboxTodayResult.error ??
    inboxMatchedTodayResult.error ??
    inboxUnmatchedResult.error ??
    inboxRepliesTodayResult.error;
  if (queryError) {
    throw new ValidationError(queryError.message);
  }

  const activeLeads = (leadsResult.data ?? []).filter((lead) => lead.merged_into_id === null);
  const leadStatuses = activeLeads.map((lead) => lead.status).filter(isLeadStatus);
  const contactStatuses = (relationshipsResult.data ?? []).map((row) => row.status).filter(isContactStatus);
  const campaignStatuses = (campaignsResult.data ?? []).map((row) => row.status).filter(isCampaignStatus);
  const accountStatuses = (accountsResult.data ?? []).map((row) => row.status).filter(isSocialAccountStatus);
  const postStatuses = (postsResult.data ?? []).map((row) => row.status).filter(isPostStatus);
  const ruleStatuses = (rulesResult.data ?? []).map((row) => row.status).filter(isMonitoringRuleStatus);

  const contactJobStatuses: JobStatus[] = [];
  const publishJobStatuses: JobStatus[] = [];
  const monitorJobStatuses: JobStatus[] = [];
  const inboxJobStatuses: JobStatus[] = [];
  for (const job of jobsResult.data ?? []) {
    if (!isJobType(job.type) || !isJobStatus(job.status)) {
      continue;
    }
    if (job.type === "CONTACT") {
      contactJobStatuses.push(job.status);
    } else if (job.type === "PUBLISH") {
      publishJobStatuses.push(job.status);
    } else if (job.type === "MONITOR") {
      monitorJobStatuses.push(job.status);
    } else {
      inboxJobStatuses.push(job.status);
    }
  }

  const leadByStatus = tallyByStatus(LEAD_STATUSES, leadStatuses);
  const contactByStatus = tallyByStatus(CONTACT_STATUSES, contactStatuses);
  const campaignByStatus = tallyByStatus(CAMPAIGN_STATUSES, campaignStatuses);

  return {
    generatedAt: new Date().toISOString(),
    leads: {
      byStatus: leadByStatus,
      activeTotal: activeLeads.length,
      doNotContact: activeLeads.filter((lead) => lead.do_not_contact).length,
      createdToday: activeLeads.filter((lead) => lead.created_at >= today).length,
      createdLast7Days: activeLeads.filter((lead) => lead.created_at >= last7Days).length,
    },
    contacts: {
      byStatus: contactByStatus,
      replied: statusCount(contactByStatus, "REPLIED"),
      successfulJobsToday: contactSuccessToday.count ?? 0,
      failedJobsToday: contactFailedToday.count ?? 0,
    },
    campaigns: {
      byStatus: campaignByStatus,
      running: statusCount(campaignByStatus, "RUNNING"),
    },
    accounts: {
      byStatus: tallyByStatus(SOCIAL_ACCOUNT_STATUSES, accountStatuses),
      total: accountStatuses.length,
    },
    posts: {
      byStatus: tallyByStatus(POST_STATUSES, postStatuses),
      publishedToday: postsPublishedToday.count ?? 0,
    },
    monitoring: {
      rulesByStatus: tallyByStatus(MONITORING_RULE_STATUSES, ruleStatuses),
      eventsToday: eventsTodayResult.count ?? 0,
      eventsLast7Days: eventsWeekResult.count ?? 0,
    },
    inbox: {
      eventsToday: inboxTodayResult.count ?? 0,
      matchedToday: inboxMatchedTodayResult.count ?? 0,
      unmatchedOpen: inboxUnmatchedResult.count ?? 0,
      repliesToday: inboxRepliesTodayResult.count ?? 0,
    },
    jobs: {
      contactByStatus: tallyByStatus(JOB_STATUSES, contactJobStatuses),
      publishByStatus: tallyByStatus(JOB_STATUSES, publishJobStatuses),
      monitorByStatus: tallyByStatus(JOB_STATUSES, monitorJobStatuses),
      inboxByStatus: tallyByStatus(JOB_STATUSES, inboxJobStatuses),
    },
  };
}

export async function countRepliedRelationships(workspaceId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("contact_relationships")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("status", "REPLIED");
  if (error) {
    throw new Error(error.message);
  }
  return count ?? 0;
}
