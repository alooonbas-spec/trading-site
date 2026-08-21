import { MONITORING_RULE_STATUSES, type MonitoringRuleStatus } from "@/types/status";
import { SOCIAL_PLATFORMS, type SocialPlatform } from "@/types/social";

export function parseMonitoringStatusFilter(value: string | undefined): MonitoringRuleStatus | undefined {
  if (value && (MONITORING_RULE_STATUSES as readonly string[]).includes(value)) {
    return value as MonitoringRuleStatus;
  }
  return undefined;
}

export function parseMonitoringPlatformFilter(value: string | undefined): SocialPlatform | undefined {
  if (value && (SOCIAL_PLATFORMS as readonly string[]).includes(value)) {
    return value as SocialPlatform;
  }
  return undefined;
}
