import type { MonitoringEvent, MonitoringRule } from "@/types/monitoring";
import type { MonitoringRuleStatus } from "@/types/status";
import type { SocialPlatform } from "@/types/social";

export type MonitoringRuleRow = {
  id: string;
  workspace_id: string;
  name: string;
  keywords: string[];
  sources: string[];
  social_account_id: string | null;
  platform: SocialPlatform;
  status: MonitoringRuleStatus;
  cursor: string | null;
  last_run_at: string | null;
  last_error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type MonitoringEventRow = {
  id: string;
  workspace_id: string;
  rule_id: string;
  social_account_id: string | null;
  external_id: string;
  author: string | null;
  content: string;
  url: string | null;
  matched_keywords: string[];
  created_at: string;
};

export function toMonitoringRule(
  row: MonitoringRuleRow,
  counts: { eventCount: number; pendingJobCount: number } = { eventCount: 0, pendingJobCount: 0 },
): MonitoringRule {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    keywords: row.keywords,
    sources: row.sources,
    socialAccountId: row.social_account_id,
    platform: row.platform,
    status: row.status,
    cursor: row.cursor,
    lastRunAt: row.last_run_at,
    lastError: row.last_error,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...counts,
  };
}

export function toMonitoringEvent(row: MonitoringEventRow): MonitoringEvent {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    ruleId: row.rule_id,
    socialAccountId: row.social_account_id,
    externalId: row.external_id,
    author: row.author,
    content: row.content,
    url: row.url,
    matchedKeywords: row.matched_keywords,
    createdAt: row.created_at,
  };
}
