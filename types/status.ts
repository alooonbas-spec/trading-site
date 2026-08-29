export const LEAD_STATUSES = [
  "NEW",
  "QUALIFIED",
  "ENGAGED",
  "INTERESTED",
  "CUSTOMER",
  "NOT_INTERESTED",
  "LOST",
  "DO_NOT_CONTACT",
  "ARCHIVED",
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const CONTACT_STATUSES = [
  "NOT_CONTACTED",
  "QUEUED",
  "INVITE_PENDING",
  "INVITE_SENT",
  "MESSAGE_PENDING",
  "MESSAGE_SENT",
  "REPLIED",
  "FAILED",
  "BLOCKED",
] as const;

export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export const CAMPAIGN_STATUSES = [
  "DRAFT",
  "RUNNING",
  "PAUSED",
  "COMPLETED",
  "CANCELLED",
] as const;

export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const JOB_STATUSES = [
  "PENDING",
  "RUNNING",
  "SUCCESS",
  "FAILED",
  "RETRY",
  "CANCELLED",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export const SOCIAL_ACCOUNT_STATUSES = [
  "CONNECTED",
  "DISCONNECTED",
  "EXPIRED",
  "ERROR",
  "REAUTH_REQUIRED",
] as const;

export type SocialAccountStatus = (typeof SOCIAL_ACCOUNT_STATUSES)[number];

export const POST_STATUSES = [
  "DRAFT",
  "SCHEDULED",
  "PUBLISHING",
  "PUBLISHED",
  "PARTIAL",
  "FAILED",
  "CANCELLED",
] as const;

export type PostStatus = (typeof POST_STATUSES)[number];

export const POST_TARGET_STATUSES = [
  "PENDING",
  "SCHEDULED",
  "PUBLISHING",
  "PUBLISHED",
  "FAILED",
  "SKIPPED",
  "CANCELLED",
] as const;

export type PostTargetStatus = (typeof POST_TARGET_STATUSES)[number];

export const MONITORING_RULE_STATUSES = ["ACTIVE", "PAUSED", "DISABLED"] as const;

export type MonitoringRuleStatus = (typeof MONITORING_RULE_STATUSES)[number];

export const WORKSPACE_ROLES = [
  "OWNER",
  "ADMIN",
  "OPERATOR",
  "VIEWER",
] as const;

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];
