import type { CampaignAction } from "@/types/campaign";
import type { JobStatus } from "@/types/status";
import type { SocialPlatform } from "@/types/social";

export type EnqueuePair = {
  leadId: string;
  socialAccountId: string;
  socialProfileId: string;
};

export type ProfileRef = {
  id: string;
  leadId: string;
  platform: SocialPlatform;
};

export type AccountRef = {
  id: string;
  platform: SocialPlatform;
};

export function buildEnqueuePairs(input: {
  leadIds: string[];
  skippedLeadIds: Set<string>;
  accounts: AccountRef[];
  profiles: ProfileRef[];
}): EnqueuePair[] {
  const pairs: EnqueuePair[] = [];
  const used = new Set<string>();

  for (const leadId of input.leadIds) {
    if (input.skippedLeadIds.has(leadId)) {
      continue;
    }

    for (const account of input.accounts) {
      const profile = input.profiles.find(
        (item) => item.leadId === leadId && item.platform === account.platform,
      );
      if (!profile) {
        continue;
      }

      const key = `${leadId}:${account.id}`;
      if (used.has(key)) {
        continue;
      }
      used.add(key);
      pairs.push({
        leadId,
        socialAccountId: account.id,
        socialProfileId: profile.id,
      });
    }
  }

  return pairs;
}

export const MONITOR_POLL_INTERVAL_MS = 5 * 60 * 1000;

export function retryDelayMs(attempts: number): number {
  const capped = Math.min(Math.max(attempts, 1), 8);
  return Math.min(60 * 60 * 1000, 30_000 * 2 ** (capped - 1));
}

export function jobStatusAfterError(input: {
  attempts: number;
  maxAttempts: number;
  retryable: boolean;
}): { status: JobStatus; runAfter: Date | null } {
  if (input.retryable && input.attempts < input.maxAttempts) {
    return {
      status: "RETRY",
      runAfter: new Date(Date.now() + retryDelayMs(input.attempts)),
    };
  }

  return { status: "FAILED", runAfter: null };
}

export function isAdapterContactAction(action: CampaignAction): boolean {
  return action === "INVITE" || action === "MESSAGE";
}

export function canStartCampaign(status: "DRAFT" | "RUNNING" | "PAUSED" | "COMPLETED" | "CANCELLED"): boolean {
  return status === "DRAFT" || status === "PAUSED";
}

export function canPauseCampaign(status: "DRAFT" | "RUNNING" | "PAUSED" | "COMPLETED" | "CANCELLED"): boolean {
  return status === "RUNNING";
}

export function canCancelCampaign(status: "DRAFT" | "RUNNING" | "PAUSED" | "COMPLETED" | "CANCELLED"): boolean {
  return status === "DRAFT" || status === "RUNNING" || status === "PAUSED";
}
