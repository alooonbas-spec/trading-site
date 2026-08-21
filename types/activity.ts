import type { SocialPlatform } from "@/types/social";

export const ACTIVITY_ACTIONS = [
  "WORKSPACE_CREATED",
  "WORKSPACE_UPDATED",
  "MEMBER_ADDED",
  "MEMBER_ROLE_UPDATED",
  "MEMBER_REMOVED",
  "LEAD_CREATED",
  "LEAD_UPDATED",
  "LEAD_MERGED",
  "SOCIAL_PROFILE_CREATED",
  "SOCIAL_PROFILE_COLLECTED",
  "CAMPAIGN_CREATED",
  "CAMPAIGN_STARTED",
  "CAMPAIGN_PAUSED",
  "CONTACT_QUEUED",
  "CONTACT_ACTION_SUCCESS",
  "CONTACT_ACTION_FAILED",
  "POST_CREATED",
  "POST_PUBLISHED",
  "POST_FAILED",
  "MONITORING_RULE_CREATED",
  "MONITORING_EVENT_CREATED",
  "MONITORING_FAILED",
  "INBOX_EVENT_CREATED",
  "INBOX_ATTACHED",
  "INBOX_REPLIED",
  "INBOX_FAILED",
  "JOB_RETRIED",
  "JOB_CANCELLED",
  "SOCIAL_ACCOUNT_CONNECTED",
  "SOCIAL_ACCOUNT_DISCONNECTED",
  "SOCIAL_ACCOUNT_TOKEN_REFRESHED",
] as const;

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

export const ACTIVITY_ENTITY_TYPES = [
  "job",
  "campaign",
  "social_account",
  "monitoring_rule",
  "inbox_event",
  "lead",
  "post",
  "social_profile",
  "contact_relationship",
] as const;

export type ActivityEntityType = (typeof ACTIVITY_ENTITY_TYPES)[number];

export const ACTIVITY_PUBLIC_COLUMNS =
  "id, workspace_id, user_id, action, platform, social_account_id, entity_type, entity_id, metadata, created_at" as const;

export type ActivityLogItem = {
  id: string;
  workspaceId: string;
  userId: string | null;
  userEmail: string | null;
  userDisplayName: string | null;
  action: string;
  platform: SocialPlatform | null;
  socialAccountId: string | null;
  accountUsername: string | null;
  accountDisplayName: string | null;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};
