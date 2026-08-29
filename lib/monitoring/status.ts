import type { MonitoringRuleStatus } from "@/types/status";

export function canPauseMonitoringRule(status: MonitoringRuleStatus): boolean {
  return status === "ACTIVE";
}

export function canResumeMonitoringRule(status: MonitoringRuleStatus): boolean {
  return status === "PAUSED";
}

export function canDisableMonitoringRule(status: MonitoringRuleStatus): boolean {
  return status === "ACTIVE" || status === "PAUSED";
}

export function canRunMonitoringRule(status: MonitoringRuleStatus): boolean {
  return status === "ACTIVE";
}
