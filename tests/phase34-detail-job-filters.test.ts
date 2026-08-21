import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseJobStatusFilter } from "@/lib/jobs/filters";

describe("detail job status filters", () => {
  it("accepts known JobStatus values and ignores invented ones", () => {
    expect(parseJobStatusFilter("FAILED")).toBe("FAILED");
    expect(parseJobStatusFilter("RETRY")).toBe("RETRY");
    expect(parseJobStatusFilter("all")).toBeUndefined();
    expect(parseJobStatusFilter("SUCCESSFUL")).toBeUndefined();
  });
});

describe("PHASE 34 detail job status filters", () => {
  it("filters scoped job queries by JobStatus without OFFSET or platform switches", () => {
    const jobs = readFileSync("services/jobs/query-service.ts", "utf8");
    const scopedStart = jobs.indexOf("async function listScopedJobsPage");
    const scopedEnd = jobs.indexOf("export async function", scopedStart + 1);
    const scoped = jobs.slice(scopedStart, scopedEnd === -1 ? undefined : scopedEnd);

    expect(jobs).toContain("listCampaignJobsPage");
    expect(jobs).toContain("listPostJobsPage");
    expect(jobs).toContain("listMonitoringJobsPage");
    expect(jobs).toContain("status?: JobStatus");
    expect(scoped).toContain("input.status");
    expect(scoped).toContain('request.eq("status", input.status)');
    expect(scoped).toContain("parseKeysetCursor");
    expect(scoped).toContain("keysetOrFilter");
    expect(jobs).not.toMatch(/offset\(/i);
    expect(jobs).not.toMatch(/if\s*\(\s*platform\s*===/);
    expect(jobs).not.toContain("do_not_contact");
  });

  it("exposes GET job status filters that omit the jobs cursor and keep created_at keyset copy", () => {
    const campaign = readFileSync("app/(dashboard)/w/[workspaceId]/campaigns/[campaignId]/page.tsx", "utf8");
    const post = readFileSync("app/(dashboard)/w/[workspaceId]/posts/[postId]/page.tsx", "utf8");
    const rule = readFileSync("app/(dashboard)/w/[workspaceId]/monitoring/[ruleId]/page.tsx", "utf8");

    for (const page of [campaign, post, rule]) {
      expect(page).toContain('name="status"');
      expect(page).toContain("parseJobStatusFilter");
      expect(page).toContain("created_at keyset");
      expect(page).toContain("JobStatus");
      expect(page).toContain("ListPagination");
      expect(page).not.toMatch(/if\s*\(\s*platform\s*===/);
    }

    expect(campaign).toContain('name="leads"');
    expect(campaign).not.toContain('name="after"');
    expect(campaign).toContain("do_not_contact");
    expect(campaign).not.toContain("listSocialAccounts(");

    expect(post).not.toContain('name="after"');
    expect(post).not.toContain("listSocialAccounts(");

    expect(rule).toContain('name="after"');
    expect(rule).not.toContain('name="jobs"');
    expect(rule).not.toContain("listSocialAccounts(");
  });
});
