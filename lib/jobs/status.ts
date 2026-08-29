import type { JobType } from "@/types/campaign";
import type { CampaignStatus, JobStatus, MonitoringRuleStatus, PostStatus, PostTargetStatus } from "@/types/status";

export function canCancelJob(status: JobStatus): boolean {
  return status === "PENDING" || status === "RETRY";
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
