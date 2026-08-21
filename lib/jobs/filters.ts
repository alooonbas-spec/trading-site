import { z } from "zod";
import { JOB_TYPES, type JobType } from "@/types/campaign";
import { JOB_STATUSES, type JobStatus } from "@/types/status";

export const JOB_TYPE_FILTERS = ["all", ...JOB_TYPES] as const;
export const JOB_STATUS_FILTERS = ["all", ...JOB_STATUSES] as const;

export type JobTypeFilter = (typeof JOB_TYPE_FILTERS)[number];
export type JobStatusFilter = (typeof JOB_STATUS_FILTERS)[number];

const accountIdSchema = z.uuid();

export function parseJobTypeFilter(value: string | undefined): JobType | undefined {
  if (value && (JOB_TYPES as readonly string[]).includes(value)) {
    return value as JobType;
  }
  return undefined;
}

export function parseJobStatusFilter(value: string | undefined): JobStatus | undefined {
  if (value && (JOB_STATUSES as readonly string[]).includes(value)) {
    return value as JobStatus;
  }
  return undefined;
}

export function parseJobAccountIdFilter(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = accountIdSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
