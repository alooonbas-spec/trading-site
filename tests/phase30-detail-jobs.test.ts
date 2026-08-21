import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("PHASE 30 detail job pagination", () => {
  it("pages campaign, post, and monitoring jobs with created_at keysets and no OFFSET", () => {
    const jobs = readFileSync("services/jobs/query-service.ts", "utf8");
    const campaigns = readFileSync("services/campaigns/campaign-service.ts", "utf8");
    const leads = readFileSync("services/leads/lead-service.ts", "utf8");
    const accounts = readFileSync("services/social-accounts/account-service.ts", "utf8");
    const worker = readFileSync("services/jobs/worker-service.ts", "utf8");

    expect(jobs).toContain("listCampaignJobsPage");
    expect(jobs).toContain("listPostJobsPage");
    expect(jobs).toContain("listMonitoringJobsPage");
    expect(jobs).toContain("JOB_PAGE_SIZE + 1");
    expect(jobs).toContain("parseKeysetCursor");
    expect(jobs).toContain("keysetOrFilter");
    expect(jobs).not.toMatch(/offset\(/i);
    expect(jobs).not.toMatch(/if\s*\(\s*platform\s*===/);
    expect(jobs).not.toContain("do_not_contact");

    expect(campaigns).toContain("listCampaignLeadsPage");
    expect(campaigns).toContain("CAMPAIGN_PAGE_SIZE + 1");
    expect(campaigns).not.toMatch(/offset\(/i);

    expect(leads).toContain("listLeadsByIds");
    const byIdsStart = leads.indexOf("export async function listLeadsByIds");
    const byIdsEnd = leads.indexOf("export async function", byIdsStart + 1);
    expect(leads.slice(byIdsStart, byIdsEnd === -1 ? undefined : byIdsEnd)).not.toContain(".limit(");

    expect(accounts).toContain("listSocialAccountsByIds");
    expect(worker).not.toContain(".limit(20)");
    expect(worker).not.toMatch(/if\s*\(\s*platform\s*===/);
  });

  it("does not load the whole CRM on campaign/post/rule detail pages", () => {
    const campaign = readFileSync("app/(dashboard)/w/[workspaceId]/campaigns/[campaignId]/page.tsx", "utf8");
    const post = readFileSync("app/(dashboard)/w/[workspaceId]/posts/[postId]/page.tsx", "utf8");
    const rule = readFileSync("app/(dashboard)/w/[workspaceId]/monitoring/[ruleId]/page.tsx", "utf8");

    expect(campaign).toContain("listCampaignJobsPage");
    expect(campaign).toContain("listCampaignLeadsPage");
    expect(campaign).toContain("listLeadsByIds");
    expect(campaign).toContain("listSocialAccountsByIds");
    expect(campaign).not.toContain("listLeads({");
    expect(campaign).not.toContain("listSocialAccounts(");
    expect(campaign).toContain("ListPagination");
    expect(campaign).toContain("query.leads");
    expect(campaign).toContain("query.after");
    expect(campaign).toContain("created_at keyset");
    expect(campaign).toContain("do_not_contact");
    expect(campaign).not.toMatch(/if\s*\(\s*platform\s*===/);

    expect(post).toContain("listPostJobsPage");
    expect(post).toContain("listSocialAccountsByIds");
    expect(post).not.toContain("listSocialAccounts(");
    expect(post).toContain("ListPagination");
    expect(post).toContain("created_at keyset");
    expect(post).not.toMatch(/if\s*\(\s*platform\s*===/);

    expect(rule).toContain("listMonitoringJobsPage");
    expect(rule).toContain("listSocialAccountsByIds");
    expect(rule).not.toContain("listMonitoringJobs(");
    expect(rule).not.toContain("listSocialAccounts(");
    expect(rule).toContain("query.jobs");
    expect(rule).toContain("query.after");
    expect(rule).toContain("created_at keyset");
    expect(rule).not.toMatch(/if\s*\(\s*platform\s*===/);
  });
});
