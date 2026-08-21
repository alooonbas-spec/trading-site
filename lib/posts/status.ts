import type { PostStatus, PostTargetStatus } from "@/types/status";

const OPEN_TARGET_STATUSES: readonly PostTargetStatus[] = ["PENDING", "SCHEDULED", "PUBLISHING"];
const FAILED_TARGET_STATUSES: readonly PostTargetStatus[] = ["FAILED", "SKIPPED"];

export function canPublishPost(status: PostStatus): boolean {
  return status === "DRAFT" || status === "SCHEDULED";
}

export function canCancelPost(status: PostStatus): boolean {
  return status === "DRAFT" || status === "SCHEDULED" || status === "PUBLISHING";
}

export function canDeletePost(status: PostStatus): boolean {
  return status !== "PUBLISHING";
}

export function rollupPostStatus(targets: PostTargetStatus[]): PostStatus {
  if (targets.length === 0) {
    return "DRAFT";
  }

  const open = targets.filter((status) => OPEN_TARGET_STATUSES.includes(status));
  const published = targets.filter((status) => status === "PUBLISHED");
  const cancelled = targets.filter((status) => status === "CANCELLED");
  const failed = targets.filter((status) => FAILED_TARGET_STATUSES.includes(status));

  if (open.length > 0) {
    if (open.every((status) => status === "SCHEDULED") && published.length === 0 && failed.length === 0) {
      return "SCHEDULED";
    }
    return "PUBLISHING";
  }

  if (published.length === targets.length) {
    return "PUBLISHED";
  }
  if (published.length > 0) {
    return "PARTIAL";
  }
  if (cancelled.length === targets.length) {
    return "CANCELLED";
  }
  return "FAILED";
}
