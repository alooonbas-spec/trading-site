import type { CampaignStatus, JobStatus } from "@/types/status";

export const CAMPAIGN_ACTIONS = [
  "INVITE",
  "MESSAGE",
  "OPEN_PROFILE",
  "MANUAL_ACTION_REQUIRED",
] as const;

export type CampaignAction = (typeof CAMPAIGN_ACTIONS)[number];

export const JOB_TYPES = ["CONTACT"] as const;
export type JobType = (typeof JOB_TYPES)[number];

export type Campaign = {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  status: CampaignStatus;
  action: CampaignAction;
  body: string | null;
  createdBy: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  leadCount: number;
  accountCount: number;
  pendingJobCount: number;
};

export type Job = {
  id: string;
  workspaceId: string;
  campaignId: string | null;
  socialAccountId: string;
  leadId: string;
  socialProfileId: string | null;
  relationshipId: string | null;
  type: JobType;
  action: CampaignAction;
  body: string | null;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  lastError: string | null;
  result: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export const CAMPAIGN_PUBLIC_COLUMNS =
  "id, workspace_id, name, description, status, action, body, created_by, started_at, completed_at, created_at, updated_at" as const;

export const JOB_PUBLIC_COLUMNS =
  "id, workspace_id, campaign_id, social_account_id, lead_id, social_profile_id, relationship_id, type, action, body, status, attempts, max_attempts, run_after, last_error, result, created_at, updated_at, completed_at" as const;
