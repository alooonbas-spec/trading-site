import type { MonitoringRuleStatus } from "@/types/status";
import type { SocialPlatform } from "@/types/social";

export type MonitoringRule = {
  id: string;
  workspaceId: string;
  name: string;
  keywords: string[];
  sources: string[];
  socialAccountId: string | null;
  platform: SocialPlatform;
  status: MonitoringRuleStatus;
  cursor: string | null;
  lastRunAt: string | null;
  lastError: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  eventCount: number;
  pendingJobCount: number;
};

export type MonitoringEvent = {
  id: string;
  workspaceId: string;
  ruleId: string;
  socialAccountId: string | null;
  externalId: string;
  author: string | null;
  content: string;
  url: string | null;
  matchedKeywords: string[];
  createdAt: string;
};

export const MONITORING_RULE_PUBLIC_COLUMNS =
  "id, workspace_id, name, keywords, sources, social_account_id, platform, status, cursor, last_run_at, last_error, created_by, created_at, updated_at" as const;

export const MONITORING_EVENT_PUBLIC_COLUMNS =
  "id, workspace_id, rule_id, social_account_id, external_id, author, content, url, matched_keywords, created_at" as const;
