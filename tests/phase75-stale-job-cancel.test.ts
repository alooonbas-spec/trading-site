import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canCancelJob, isStaleRunningJob } from "@/lib/jobs/status";
import { STALE_RUNNING_JOB_MS } from "@/lib/jobs/queue-rules";

describe("PHASE 75 stale job cancel", () => {
  it("combines canCancelJob with isStaleRunningJob for the operator-facing decision", () => {
    const now = new Date("2026-08-22T12:00:00.000Z");
    const staleLockedAt = new Date(now.getTime() - STALE_RUNNING_JOB_MS).toISOString();
    const freshLockedAt = new Date(now.getTime() - 60_000).toISOString();

    expect(canCancelJob("RUNNING") || isStaleRunningJob("RUNNING", staleLockedAt, now)).toBe(true);
    expect(canCancelJob("RUNNING") || isStaleRunningJob("RUNNING", freshLockedAt, now)).toBe(false);
    expect(canCancelJob("PENDING") || isStaleRunningJob("PENDING", null, now)).toBe(true);
    expect(canCancelJob("SUCCESS") || isStaleRunningJob("SUCCESS", staleLockedAt, now)).toBe(false);
  });

  it("cancels a stale RUNNING job with a re-checked locked_at guard, not a bare status match", () => {
    const control = readFileSync("services/jobs/control-service.ts", "utf8");
    expect(control).toContain("isStaleRunningJob(job.status, job.lockedAt)");
    expect(control).toContain('.eq("status", "RUNNING").lt("locked_at", staleThreshold)');
    expect(control).toContain('.in("status", ["PENDING", "RETRY"])');
    expect(control).toContain("Only PENDING, RETRY, or stale RUNNING jobs can be cancelled");
  });

  it("surfaces the stale flag on cancel activity without inventing a new SQL enum", () => {
    const control = readFileSync("services/jobs/control-service.ts", "utf8");
    expect(control).toContain("metadata: { type: job.type, stale }");
  });

  it("lets the Jobs UI cancel a Stale job, not just PENDING/RETRY", () => {
    const query = readFileSync("services/jobs/query-service.ts", "utf8");
    expect(query).toContain("canCancelJob(job.status) || isStaleRunningJob(job.status, job.lockedAt)");
  });
});
