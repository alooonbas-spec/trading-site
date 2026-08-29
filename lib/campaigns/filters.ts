import { CAMPAIGN_STATUSES, type CampaignStatus } from "@/types/status";

export function parseCampaignStatusFilter(value: string | undefined): CampaignStatus | undefined {
  if (value && (CAMPAIGN_STATUSES as readonly string[]).includes(value)) {
    return value as CampaignStatus;
  }
  return undefined;
}
