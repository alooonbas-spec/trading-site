import { describe, expect, it } from "vitest";
import { isStaleRunningJob } from "@/lib/jobs/status";
import { STALE_RUNNING_JOB_MS } from "@/lib/jobs/queue-rules";

describe("PHASE 74 stale job visibility", () => {
  const now = new Date("2026-08-22T12:00:00.000Z");

  it("flags a RUNNING job whose lock is at least 15 minutes old", () => {
    const lockedAt = new Date(now.getTime() - STALE_RUNNING_JOB_MS).toISOString();
    expect(isStaleRunningJob("RUNNING", lockedAt, now)).toBe(true);
  });

  it("does not flag a RUNNING job locked moments ago", () => {
    const lockedAt = new Date(now.getTime() - 60_000).toISOString();
    expect(isStaleRunningJob("RUNNING", lockedAt, now)).toBe(false);
  });

  it("does not flag non-RUNNING statuses regardless of lockedAt age", () => {
    const lockedAt = new Date(now.getTime() - STALE_RUNNING_JOB_MS * 10).toISOString();
    for (const status of ["PENDING", "RETRY", "SUCCESS", "FAILED", "CANCELLED"] as const) {
      expect(isStaleRunningJob(status, lockedAt, now)).toBe(false);
    }
  });

  it("does not flag a RUNNING job with no lockedAt", () => {
    expect(isStaleRunningJob("RUNNING", null, now)).toBe(false);
  });

  it("does not flag a RUNNING job with an unparseable lockedAt", () => {
    expect(isStaleRunningJob("RUNNING", "not-a-date", now)).toBe(false);
  });
});
