import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { workspaceNav } from "@/config/navigation";
import {
  JOB_STATUS_FILTERS,
  JOB_TYPE_FILTERS,
  parseJobAccountIdFilter,
  parseJobStatusFilter,
  parseJobTypeFilter,
} from "@/lib/jobs/filters";
import { canCancelJob, canRetryFailedJob } from "@/lib/jobs/status";
import { ACTIVITY_ACTIONS } from "@/types/activity";
import { JOB_TYPES } from "@/types/campaign";
import { JOB_STATUSES } from "@/types/status";

describe("job queue filters", () => {
  it("parses type, status, and account without inventing values", () => {
    expect(parseJobTypeFilter("CONTACT")).toBe("CONTACT");
    expect(parseJobTypeFilter("INBOX")).toBe("INBOX");
    expect(parseJobTypeFilter("all")).toBeUndefined();
    expect(parseJobTypeFilter("invite")).toBeUndefined();
    expect(JOB_TYPE_FILTERS).toEqual(["all", ...JOB_TYPES]);

    expect(parseJobStatusFilter("FAILED")).toBe("FAILED");
    expect(parseJobStatusFilter("PENDING")).toBe("PENDING");
    expect(parseJobStatusFilter("all")).toBeUndefined();
    expect(parseJobStatusFilter("done")).toBeUndefined();
    expect(JOB_STATUS_FILTERS).toEqual(["all", ...JOB_STATUSES]);

    expect(parseJobAccountIdFilter("11111111-1111-4111-8111-111111111111")).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(parseJobAccountIdFilter("not-a-uuid")).toBeUndefined();
    expect(parseJobAccountIdFilter("")).toBeUndefined();
  });
});

describe("job retry and cancel rules", () => {
  it("cancels only PENDING and RETRY jobs", () => {
    expect(canCancelJob("PENDING")).toBe(true);
    expect(canCancelJob("RETRY")).toBe(true);
    expect(canCancelJob("FAILED")).toBe(false);
    expect(canCancelJob("SUCCESS")).toBe(false);
    expect(canCancelJob("RUNNING")).toBe(false);
    expect(canCancelJob("CANCELLED")).toBe(false);
  });

  it("retries FAILED jobs only when parent machines still allow work", () => {
    expect(
      canRetryFailedJob({
        jobStatus: "FAILED",
        jobType: "INBOX",
      }),
    ).toBe(true);
    expect(
      canRetryFailedJob({
        jobStatus: "SUCCESS",
        jobType: "INBOX",
      }),
    ).toBe(false);
    expect(
      canRetryFailedJob({
        jobStatus: "CANCELLED",
        jobType: "INBOX",
      }),
    ).toBe(false);
    expect(
      canRetryFailedJob({
        jobStatus: "RUNNING",
        jobType: "INBOX",
      }),
    ).toBe(false);

    expect(
      canRetryFailedJob({
        jobStatus: "FAILED",
        jobType: "CONTACT",
        campaignStatus: "RUNNING",
      }),
    ).toBe(true);
    expect(
      canRetryFailedJob({
        jobStatus: "FAILED",
        jobType: "CONTACT",
        campaignStatus: "PAUSED",
      }),
    ).toBe(false);
    expect(
      canRetryFailedJob({
        jobStatus: "FAILED",
        jobType: "CONTACT",
        campaignStatus: "COMPLETED",
      }),
    ).toBe(false);

    expect(
      canRetryFailedJob({
        jobStatus: "FAILED",
        jobType: "PUBLISH",
        postStatus: "PUBLISHED",
        postTargetStatus: "FAILED",
      }),
    ).toBe(true);
    expect(
      canRetryFailedJob({
        jobStatus: "FAILED",
        jobType: "PUBLISH",
        postStatus: "CANCELLED",
        postTargetStatus: "FAILED",
      }),
    ).toBe(false);
    expect(
      canRetryFailedJob({
        jobStatus: "FAILED",
        jobType: "PUBLISH",
        postStatus: "PUBLISHED",
        postTargetStatus: "PUBLISHED",
      }),
    ).toBe(false);

    expect(
      canRetryFailedJob({
        jobStatus: "FAILED",
        jobType: "MONITOR",
        monitoringRuleStatus: "ACTIVE",
      }),
    ).toBe(true);
    expect(
      canRetryFailedJob({
        jobStatus: "FAILED",
        jobType: "MONITOR",
        monitoringRuleStatus: "PAUSED",
      }),
    ).toBe(false);
  });
});

describe("PHASE 24 jobs queue", () => {
  it("lists and controls jobs without platform switches or do_not_contact", () => {
    const query = readFileSync("services/jobs/query-service.ts", "utf8");
    const control = readFileSync("services/jobs/control-service.ts", "utf8");
    const actions = readFileSync("app/actions/jobs.ts", "utf8");
    const combined = `${query}\n${control}\n${actions}`;

    expect(query).toContain("listWorkspaceJobs");
    expect(query).toContain("canRetryFailedJob");
    expect(query).toContain("canCancelJob");
    expect(control).toContain('status: "PENDING"');
    expect(control).toContain('status: "CANCELLED"');
    expect(control).toContain("refreshPostRollup");
    expect(control).not.toContain('.from("leads")');
    expect(control).not.toContain("do_not_contact");
    expect(control).not.toContain("LeadStatus");
    expect(actions).toContain("processJobBatch");
    expect(actions).toContain("limit: 20");
    expect(combined).not.toMatch(/platform\s*===\s*["']telegram["']/);
    expect(combined).not.toMatch(/if\s*\(\s*platform\s*===/);
  });

  it("exposes the Jobs page and shared-queue processing", () => {
    const page = readFileSync("app/(dashboard)/w/[workspaceId]/jobs/page.tsx", "utf8");
    const controls = readFileSync("components/jobs/jobs-queue-controls.tsx", "utf8");
    const rows = readFileSync("components/jobs/job-row-controls.tsx", "utf8");
    const nav = workspaceNav("ws-1");

    expect(nav.some((item) => item.href === "/w/ws-1/jobs" && item.title === "Jobs")).toBe(true);
    expect(page).toContain('name="type"');
    expect(page).toContain('name="status"');
    expect(page).toContain('name="account"');
    expect(page).toContain("Retry does not rewrite LeadStatus or do_not_contact");
    expect(page).toContain("JobRowControls");
    expect(controls).toContain("processWorkspaceQueueAction");
    expect(controls).toContain("Process queue");
    expect(controls).toContain("SKIP LOCKED");
    expect(rows).toContain("retryFailedJobAction");
    expect(rows).toContain("cancelQueuedJobAction");
  });

  it("records retry and cancel as activity without adding a SQL enum", () => {
    expect(ACTIVITY_ACTIONS).toContain("JOB_RETRIED");
    expect(ACTIVITY_ACTIONS).toContain("JOB_CANCELLED");
    const control = readFileSync("services/jobs/control-service.ts", "utf8");
    expect(control).toContain('action: "JOB_RETRIED"');
    expect(control).toContain('action: "JOB_CANCELLED"');
  });
});
