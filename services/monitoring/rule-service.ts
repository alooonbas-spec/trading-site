import { createClient } from "@/lib/supabase/server";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { assertCanManageWorkspace, assertCanMutateWorkspaceData } from "@/lib/auth/permissions";
import { ValidationError } from "@/lib/errors";
import {
  DEFAULT_PAGE_SIZE,
  keysetOrFilter,
  nextKeysetCursor,
  parseKeysetCursor,
  splitKeysetRows,
  type KeysetPage,
} from "@/lib/pagination/keyset";
import { logActivity } from "@/services/activity/activity-service";
import { createMonitoringRuleSchema } from "@/lib/validation/monitoring";
import { normalizeKeywords } from "@/lib/monitoring/keywords";
import {
  canDisableMonitoringRule,
  canPauseMonitoringRule,
  canResumeMonitoringRule,
  canRunMonitoringRule,
} from "@/lib/monitoring/status";
import { assertMonitorSourcesAllowed } from "@/social/core/monitor-sources";
import {
  MONITORING_EVENT_PUBLIC_COLUMNS,
  MONITORING_RULE_PUBLIC_COLUMNS,
  type MonitoringEvent,
  type MonitoringRule,
} from "@/types/monitoring";
import { toMonitoringEvent, toMonitoringRule } from "@/services/monitoring/mapper";
import { enqueueMonitorJob } from "@/services/jobs/enqueue-service";
import { SOCIAL_ACCOUNT_PUBLIC_COLUMNS } from "@/types/social-account";
import type { SocialPlatform } from "@/types/social";

const MONITORING_RULE_PAGE_SIZE = DEFAULT_PAGE_SIZE;
const MONITORING_EVENT_PAGE_SIZE = DEFAULT_PAGE_SIZE;

export async function listMonitoringRules(workspaceId: string): Promise<MonitoringRule[]> {
  await requireWorkspaceContext(workspaceId);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("monitoring_rules")
    .select(MONITORING_RULE_PUBLIC_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new ValidationError(error.message);
  }

  return attachRuleCounts(workspaceId, (data ?? []).map((row) => toMonitoringRule(row)));
}

export async function listMonitoringRulesPage(
  workspaceId: string,
  after?: string,
): Promise<KeysetPage<MonitoringRule>> {
  await requireWorkspaceContext(workspaceId);
  const supabase = await createClient();
  const cursor = parseKeysetCursor(after);
  let request = supabase
    .from("monitoring_rules")
    .select(MONITORING_RULE_PUBLIC_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(MONITORING_RULE_PAGE_SIZE + 1);
  if (cursor) {
    request = request.or(keysetOrFilter(cursor));
  }

  const { data, error } = await request;
  if (error) {
    throw new ValidationError(error.message);
  }

  const { page, hasMore } = splitKeysetRows(data ?? [], MONITORING_RULE_PAGE_SIZE);
  return {
    items: await attachRuleCounts(
      workspaceId,
      page.map((row) => toMonitoringRule(row)),
    ),
    nextCursor: nextKeysetCursor(page, hasMore),
  };
}

export async function getMonitoringRule(workspaceId: string, ruleId: string): Promise<MonitoringRule> {
  await requireWorkspaceContext(workspaceId);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("monitoring_rules")
    .select(MONITORING_RULE_PUBLIC_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("id", ruleId)
    .maybeSingle();

  if (error) {
    throw new ValidationError(error.message);
  }
  if (!data) {
    throw new ValidationError("Monitoring rule not found");
  }

  const [rule] = await attachRuleCounts(workspaceId, [toMonitoringRule(data)]);
  if (!rule) {
    throw new ValidationError("Monitoring rule not found");
  }
  return rule;
}

export async function listMonitoringEventsPage(
  workspaceId: string,
  ruleId: string,
  after?: string,
): Promise<KeysetPage<MonitoringEvent>> {
  await requireWorkspaceContext(workspaceId);
  const supabase = await createClient();
  const cursor = parseKeysetCursor(after);
  let request = supabase
    .from("monitoring_events")
    .select(MONITORING_EVENT_PUBLIC_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("rule_id", ruleId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(MONITORING_EVENT_PAGE_SIZE + 1);
  if (cursor) {
    request = request.or(keysetOrFilter(cursor));
  }

  const { data, error } = await request;
  if (error) {
    throw new ValidationError(error.message);
  }

  const { page, hasMore } = splitKeysetRows(data ?? [], MONITORING_EVENT_PAGE_SIZE);
  return {
    items: page.map(toMonitoringEvent),
    nextCursor: nextKeysetCursor(page, hasMore),
  };
}

export async function countMonitoringEventsToday(workspaceId: string): Promise<number> {
  const supabase = await createClient();
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const { count, error } = await supabase
    .from("monitoring_events")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .gte("created_at", startOfDay.toISOString());

  if (error) {
    throw new Error(error.message);
  }
  return count ?? 0;
}

export async function createMonitoringRule(input: {
  workspaceId: string;
  name: string;
  keywords: string[];
  sources: string[];
  platform: SocialPlatform;
  socialAccountId: string | null;
}): Promise<MonitoringRule> {
  const context = await requireWorkspaceContext(input.workspaceId);
  assertCanMutateWorkspaceData(context.role);
  const parsed = createMonitoringRuleSchema.parse({
    name: input.name,
    keywords: normalizeKeywords(input.keywords),
    sources: input.sources.map((source) => source.trim()).filter(Boolean),
    platform: input.platform,
    socialAccountId: input.socialAccountId,
  });
  assertMonitorSourcesAllowed(parsed.platform, parsed.sources);

  const supabase = await createClient();
  if (parsed.socialAccountId) {
    const { data: account, error: accountError } = await supabase
      .from("social_accounts")
      .select(SOCIAL_ACCOUNT_PUBLIC_COLUMNS)
      .eq("workspace_id", input.workspaceId)
      .eq("id", parsed.socialAccountId)
      .maybeSingle();
    if (accountError || !account) {
      throw new ValidationError("Social account not found");
    }
    if (account.platform !== parsed.platform) {
      throw new ValidationError("Monitoring account must match the selected platform");
    }
  }

  const { data, error } = await supabase
    .from("monitoring_rules")
    .insert({
      workspace_id: input.workspaceId,
      name: parsed.name,
      keywords: parsed.keywords,
      sources: parsed.sources,
      platform: parsed.platform,
      social_account_id: parsed.socialAccountId,
      created_by: context.user.id,
    })
    .select(MONITORING_RULE_PUBLIC_COLUMNS)
    .single();

  if (error || !data) {
    throw new ValidationError(error?.message ?? "Unable to create monitoring rule");
  }

  await logActivity({
    workspaceId: input.workspaceId,
    userId: context.user.id,
    action: "MONITORING_RULE_CREATED",
    socialAccountId: parsed.socialAccountId,
    entityType: "monitoring_rule",
    entityId: data.id,
  });

  await enqueueMonitorJob({
    workspaceId: input.workspaceId,
    ruleId: data.id,
    runAfter: new Date().toISOString(),
  });

  return getMonitoringRule(input.workspaceId, data.id);
}

export async function runMonitoringRule(input: { workspaceId: string; ruleId: string }): Promise<number> {
  const context = await requireWorkspaceContext(input.workspaceId);
  assertCanMutateWorkspaceData(context.role);
  const rule = await getMonitoringRule(input.workspaceId, input.ruleId);
  if (!canRunMonitoringRule(rule.status)) {
    throw new ValidationError("Only ACTIVE monitoring rules can be run");
  }

  return enqueueMonitorJob({
    workspaceId: input.workspaceId,
    ruleId: input.ruleId,
    runAfter: new Date().toISOString(),
  });
}

export async function pauseMonitoringRule(input: { workspaceId: string; ruleId: string }): Promise<void> {
  const context = await requireWorkspaceContext(input.workspaceId);
  assertCanMutateWorkspaceData(context.role);
  const rule = await getMonitoringRule(input.workspaceId, input.ruleId);
  if (!canPauseMonitoringRule(rule.status)) {
    throw new ValidationError("This monitoring rule cannot be paused in its current status");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("monitoring_rules")
    .update({ status: "PAUSED" })
    .eq("id", input.ruleId)
    .eq("workspace_id", input.workspaceId);
  if (error) {
    throw new ValidationError(error.message);
  }
}

export async function resumeMonitoringRule(input: { workspaceId: string; ruleId: string }): Promise<number> {
  const context = await requireWorkspaceContext(input.workspaceId);
  assertCanMutateWorkspaceData(context.role);
  const rule = await getMonitoringRule(input.workspaceId, input.ruleId);
  if (!canResumeMonitoringRule(rule.status)) {
    throw new ValidationError("This monitoring rule cannot be resumed in its current status");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("monitoring_rules")
    .update({ status: "ACTIVE", last_error: null })
    .eq("id", input.ruleId)
    .eq("workspace_id", input.workspaceId);
  if (error) {
    throw new ValidationError(error.message);
  }

  return enqueueMonitorJob({
    workspaceId: input.workspaceId,
    ruleId: input.ruleId,
    runAfter: new Date().toISOString(),
  });
}

export async function disableMonitoringRule(input: { workspaceId: string; ruleId: string }): Promise<void> {
  const context = await requireWorkspaceContext(input.workspaceId);
  assertCanMutateWorkspaceData(context.role);
  const rule = await getMonitoringRule(input.workspaceId, input.ruleId);
  if (!canDisableMonitoringRule(rule.status)) {
    throw new ValidationError("This monitoring rule cannot be disabled in its current status");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("monitoring_rules")
    .update({ status: "DISABLED" })
    .eq("id", input.ruleId)
    .eq("workspace_id", input.workspaceId);
  if (error) {
    throw new ValidationError(error.message);
  }

  const { error: jobError } = await supabase
    .from("jobs")
    .update({
      status: "CANCELLED",
      locked_at: null,
      locked_by: null,
      completed_at: new Date().toISOString(),
      last_error: "Monitoring rule was disabled",
    })
    .eq("monitoring_rule_id", input.ruleId)
    .in("status", ["PENDING", "RETRY", "RUNNING"]);
  if (jobError) {
    throw new ValidationError(jobError.message);
  }
}

export async function deleteMonitoringRule(input: { workspaceId: string; ruleId: string }): Promise<void> {
  const context = await requireWorkspaceContext(input.workspaceId);
  assertCanManageWorkspace(context.role);
  await getMonitoringRule(input.workspaceId, input.ruleId);

  const supabase = await createClient();
  const { error } = await supabase
    .from("monitoring_rules")
    .delete()
    .eq("id", input.ruleId)
    .eq("workspace_id", input.workspaceId);
  if (error) {
    throw new ValidationError(error.message);
  }
}

async function attachRuleCounts(workspaceId: string, rules: MonitoringRule[]): Promise<MonitoringRule[]> {
  if (rules.length === 0) {
    return rules;
  }

  const supabase = await createClient();
  const ruleIds = rules.map((rule) => rule.id);
  const [{ data: events, error: eventError }, { data: jobs, error: jobError }] = await Promise.all([
    supabase.from("monitoring_events").select("rule_id").eq("workspace_id", workspaceId).in("rule_id", ruleIds),
    supabase
      .from("jobs")
      .select("monitoring_rule_id, status")
      .eq("workspace_id", workspaceId)
      .in("monitoring_rule_id", ruleIds)
      .in("status", ["PENDING", "RETRY", "RUNNING"]),
  ]);

  if (eventError) {
    throw new ValidationError(eventError.message);
  }
  if (jobError) {
    throw new ValidationError(jobError.message);
  }

  const eventCounts = new Map<string, number>();
  for (const row of events ?? []) {
    eventCounts.set(row.rule_id, (eventCounts.get(row.rule_id) ?? 0) + 1);
  }
  const jobCounts = new Map<string, number>();
  for (const row of jobs ?? []) {
    if (!row.monitoring_rule_id) {
      continue;
    }
    jobCounts.set(row.monitoring_rule_id, (jobCounts.get(row.monitoring_rule_id) ?? 0) + 1);
  }

  return rules.map((rule) => ({
    ...rule,
    eventCount: eventCounts.get(rule.id) ?? 0,
    pendingJobCount: jobCounts.get(rule.id) ?? 0,
  }));
}
