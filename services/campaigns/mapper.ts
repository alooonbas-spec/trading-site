import type { Campaign, CampaignAction, Job, JobType } from "@/types/campaign";
import type { CampaignStatus, JobStatus } from "@/types/status";

type CampaignRow = {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  status: CampaignStatus;
  action: CampaignAction;
  body: string | null;
  created_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type JobRow = {
  id: string;
  workspace_id: string;
  campaign_id: string | null;
  social_account_id: string;
  lead_id: string;
  social_profile_id: string | null;
  relationship_id: string | null;
  type: JobType;
  action: CampaignAction;
  body: string | null;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  run_after: string;
  last_error: string | null;
  result: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export function toCampaign(
  row: CampaignRow,
  counts: { leadCount: number; accountCount: number; pendingJobCount: number } = {
    leadCount: 0,
    accountCount: 0,
    pendingJobCount: 0,
  },
): Campaign {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description,
    status: row.status,
    action: row.action,
    body: row.body,
    createdBy: row.created_by,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...counts,
  };
}

export function toJob(row: JobRow): Job {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    campaignId: row.campaign_id,
    socialAccountId: row.social_account_id,
    leadId: row.lead_id,
    socialProfileId: row.social_profile_id,
    relationshipId: row.relationship_id,
    type: row.type,
    action: row.action,
    body: row.body,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    runAfter: row.run_after,
    lastError: row.last_error,
    result: row.result,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}
