import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function exportBody(source: string, exportName: string, nextExportName?: string): string {
  const start = source.indexOf(`export async function ${exportName}`);
  expect(start).toBeGreaterThan(-1);
  const searchFrom = start + `export async function ${exportName}`.length;
  const end = nextExportName
    ? source.indexOf(`export async function ${nextExportName}`, start + 1)
    : source.indexOf("export async function", searchFrom);
  if (nextExportName) {
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
  }
  return end === -1 ? source.slice(start) : source.slice(start, end);
}

describe("PHASE 38 detail membership pagination", () => {
  it("pages post targets and campaign accounts with created_at keysets and keeps unbounded lists", () => {
    const posts = readFileSync("services/posts/post-service.ts", "utf8");
    const campaigns = readFileSync("services/campaigns/campaign-service.ts", "utf8");
    const enqueue = readFileSync("services/jobs/enqueue-service.ts", "utf8");

    expect(exportBody(posts, "listPostTargets", "listPostTargetsPage")).not.toContain(".limit(");
    expect(exportBody(posts, "listPostTargets", "listPostTargetsPage")).not.toContain("parseKeysetCursor");
    expect(posts).toContain("listPostTargetsPage");
    expect(posts).toContain("POST_PAGE_SIZE + 1");
    expect(exportBody(posts, "listPostTargetsPage")).toContain("parseKeysetCursor");
    expect(exportBody(posts, "listPostTargetsPage")).toContain("keysetOrFilter");
    expect(exportBody(posts, "listPostTargetsPage")).toContain("nextKeysetCursor");
    expect(posts).not.toMatch(/offset\(/i);
    expect(posts).not.toMatch(/if\s*\(\s*platform\s*===/);

    expect(exportBody(campaigns, "listCampaignAccountIds")).not.toContain(".limit(");
    expect(exportBody(campaigns, "listCampaignAccountIds")).not.toContain("parseKeysetCursor");
    expect(campaigns).toContain("listCampaignAccountsPage");
    expect(campaigns).toContain("CAMPAIGN_PAGE_SIZE + 1");
    expect(exportBody(campaigns, "listCampaignAccountsPage", "getCampaign")).toContain("parseKeysetCursor");
    expect(exportBody(campaigns, "listCampaignAccountsPage", "getCampaign")).toContain("keysetOrFilter");
    expect(exportBody(campaigns, "listCampaignAccountsPage", "getCampaign")).toContain("nextKeysetCursor");
    expect(exportBody(campaigns, "listCampaignAccountsPage", "getCampaign")).toContain("listSocialAccountsByIds");
    expect(campaigns).not.toMatch(/offset\(/i);
    expect(campaigns).not.toMatch(/if\s*\(\s*platform\s*===/);
    expect(campaigns).not.toContain("do_not_contact");

    expect(enqueue).toContain('from("campaign_accounts")');
    expect(enqueue).toContain('from("post_targets")');
    expect(enqueue).not.toContain(".limit(");
    expect(enqueue).not.toContain("listPostTargetsPage");
    expect(enqueue).not.toContain("listCampaignAccountsPage");
  });

  it("paginates campaign accounts and post targets independently from jobs with created_at keyset copy", () => {
    const campaign = readFileSync("app/(dashboard)/w/[workspaceId]/campaigns/[campaignId]/page.tsx", "utf8");
    const post = readFileSync("app/(dashboard)/w/[workspaceId]/posts/[postId]/page.tsx", "utf8");

    expect(campaign).toContain("listCampaignAccountsPage");
    expect(campaign).toContain("listCampaignLeadsPage");
    expect(campaign).toContain("listCampaignJobsPage");
    expect(campaign).not.toContain("listCampaignAccountIds");
    expect(campaign).not.toContain("listSocialAccounts(");
    expect(campaign).toContain("query.accounts");
    expect(campaign).toContain("query.leads");
    expect(campaign).toContain("query.after");
    expect(campaign).toContain('name="accounts"');
    expect(campaign).toContain('name="leads"');
    expect(campaign).not.toContain('name="after"');
    expect(campaign).toContain("created_at keyset");
    expect(campaign).toContain("do_not_contact");
    expect(campaign).toContain("ListPagination");
    expect(campaign).not.toMatch(/if\s*\(\s*platform\s*===/);

    expect(post).toContain("listPostTargetsPage");
    expect(post).not.toContain("listPostTargets(");
    expect(post).toContain("listPostJobsPage");
    expect(post).toContain("query.targets");
    expect(post).toContain("query.after");
    expect(post).toContain('name="targets"');
    expect(post).not.toContain('name="after"');
    expect(post).toContain("created_at keyset");
    expect(post).toContain("PostTargetStatus");
    expect(post).toContain("ListPagination");
    expect(post).not.toContain("listSocialAccounts(");
    expect(post).not.toMatch(/if\s*\(\s*platform\s*===/);
  });
});
