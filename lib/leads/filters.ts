import { LEAD_STATUSES, type LeadStatus } from "@/types/status";

export type LeadDncFilter = "all" | "yes" | "no";

export function parseLeadStatusFilter(value: string | undefined): LeadStatus | "all" {
  if (!value || value === "all") {
    return "all";
  }
  if ((LEAD_STATUSES as readonly string[]).includes(value)) {
    return value as LeadStatus;
  }
  return "all";
}

export function parseLeadDncFilter(value: string | undefined): LeadDncFilter {
  if (value === "yes" || value === "no") {
    return value;
  }
  return "all";
}
