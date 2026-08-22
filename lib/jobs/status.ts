import { STALE_RUNNING_JOB_MS } from "@/lib/jobs/queue-rules";
import type { JobType } from "@/types/campaign";
import type { CampaignStatus, JobStatus, MonitoringRuleStatus, PostStatus, PostTargetStatus } from "@/types/status";

export function canCancelJob(status: JobStatus): boolean {
  return status === "PENDING" || status === "RETRY";
}

// A RUNNING job past this age is either still legitimately in flight or was
// already reclaimed by claim_jobs / claim_due_jobs (PHASE 73). Either way it
// is worth surfacing to an operator, not a signal to act on directly.
export function isStaleRunningJob(status: JobStatus, lockedAt: string | null, now: Date = new Date()): boolean {
  if (status !== "RUNNING" || !lockedAt) {
    return false;
  }
  const lockedAtMs = Date.parse(lockedAt);
  if (!Number.isFinite(lockedAtMs)) {
    return false;
  }
  return now.getTime() - lockedAtMs >= STALE_RUNNING_JOB_MS;
}

export function canRetryFailedJob(input: {
  jobStatus: JobStatus;
  jobType: JobType;
  campaignStatus?: CampaignStatus | null;
  postStatus?: PostStatus | null;
  postTargetStatus?: PostTargetStatus | null;
  monitoringRuleStatus?: MonitoringRuleStatus | null;
}): boolean {
  if (input.jobStatus !== "FAILED") {
    return false;
  }
  if (input.jobType === "CONTACT") {
    return input.campaignStatus === "RUNNING";
  }
  if (input.jobType === "PUBLISH") {
    if (!input.postStatus || input.postStatus === "CANCELLED") {
      return false;
    }
    if (input.postTargetStatus === "PUBLISHED" || input.postTargetStatus === "CANCELLED") {
      return false;
    }
    return true;
  }
  if (input.jobType === "MONITOR") {
    return input.monitoringRuleStatus === "ACTIVE";
  }
  return true;
}
