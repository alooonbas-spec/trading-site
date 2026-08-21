import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseLeadDncFilter, parseLeadStatusFilter } from "@/lib/leads/filters";

function unboundedListBody(source: string, exportName: string, nextExportName: string): string {
  const start = source.indexOf(`export async function ${exportName}`);
  const end = source.indexOf(`export async function ${nextExportName}`, start + 1);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("lead list filters", () => {
  it("accepts known statuses and DNC flags and ignores invented values", () => {
    expect(parseLeadStatusFilter("NEW")).toBe("NEW");
    expect(parseLeadStatusFilter("DO_NOT_CONTACT")).toBe("DO_NOT_CONTACT");
    expect(parseLeadStatusFilter("not-a-status")).toBe("all");
    expect(parseLeadDncFilter("yes")).toBe("yes");
    expect(parseLeadDncFilter("no")).toBe("no");
    expect(parseLeadDncFilter("blocked")).toBe("all");
  });
});

describe("PHASE 29 operator index pagination", () => {
  it("pages leads, campaigns, posts, monitoring rules, and monitoring events with created_at keysets", () => {
    const leads = readFileSync("services/leads/lead-service.ts", "utf8");
    const campaigns = readFileSync("services/campaigns/campaign-service.ts", "utf8");
    const posts = readFileSync("services/posts/post-service.ts", "utf8");
    const monitoring = readFileSync("services/monitoring/rule-service.ts", "utf8");

    expect(unboundedListBody(leads, "listLeads", "listLeadsPage")).not.toContain(".limit(");
    expect(unboundedListBody(leads, "listLeads", "listLeadsPage")).not.toContain("parseKeysetCursor");
    expect(leads).toContain("listLeadsPage");
    expect(leads).toContain("LEAD_PAGE_SIZE + 1");
    expect(leads).toContain("do_not_contact");

    expect(unboundedListBody(campaigns, "listCampaigns", "listCampaignsPage")).not.toContain(".limit(");
    expect(campaigns).toContain("CAMPAIGN_PAGE_SIZE + 1");
    expect(unboundedListBody(posts, "listPosts", "listPostsPage")).not.toContain(".limit(");
    expect(posts).toContain("POST_PAGE_SIZE + 1");
    expect(unboundedListBody(monitoring, "listMonitoringRules", "listMonitoringRulesPage")).not.toContain(
      ".limit(",
    );
    expect(monitoring).toContain("MONITORING_RULE_PAGE_SIZE + 1");
    expect(monitoring).toContain("listMonitoringEventsPage");
    expect(monitoring).toContain("MONITORING_EVENT_PAGE_SIZE + 1");
    expect(monitoring).not.toContain(".limit(100)");

    for (const source of [leads, campaigns, posts, monitoring]) {
      expect(source).toContain("parseKeysetCursor");
      expect(source).toContain("keysetOrFilter");
      expect(source).toContain("nextKeysetCursor");
      expect(source).not.toMatch(/offset\(/i);
      expect(source).not.toMatch(/if\s*\(\s*platform\s*===/);
    }
    expect(campaigns).not.toContain("do_not_contact");
    expect(posts).not.toContain("do_not_contact");
    expect(monitoring).not.toContain("do_not_contact");
  });

  it("exposes Newest/Older links on index pages", () => {
    const leadsPage = readFileSync("app/(dashboard)/w/[workspaceId]/leads/page.tsx", "utf8");
    const campaignsPage = readFileSync("app/(dashboard)/w/[workspaceId]/campaigns/page.tsx", "utf8");
    const postsPage = readFileSync("app/(dashboard)/w/[workspaceId]/posts/page.tsx", "utf8");
    const monitoringPage = readFileSync("app/(dashboard)/w/[workspaceId]/monitoring/page.tsx", "utf8");
    const rulePage = readFileSync("app/(dashboard)/w/[workspaceId]/monitoring/[ruleId]/page.tsx", "utf8");
    const inboxPage = readFileSync("app/(dashboard)/w/[workspaceId]/inbox/page.tsx", "utf8");
    const leadDetail = readFileSync("app/(dashboard)/w/[workspaceId]/leads/[leadId]/page.tsx", "utf8");

    for (const page of [leadsPage, campaignsPage, postsPage, monitoringPage, rulePage]) {
      expect(page).toContain("ListPagination");
      expect(page).toContain("after:");
      expect(page).toContain("created_at keyset");
      expect(page).not.toMatch(/if\s*\(\s*platform\s*===/);
    }

    expect(leadsPage).toContain("listLeadsPage");
    expect(leadsPage).toContain("do_not_contact");
    expect(leadsPage).not.toContain("name=\"after\"");
    expect(campaignsPage).toContain("listCampaignsPage");
    expect(campaignsPage).toContain("searchPickerLeads");
    expect(inboxPage).toContain("searchPickerLeads");
    expect(leadDetail).toContain("searchPickerLeads");
    expect(rulePage).toContain("listMonitoringEventsPage");
  });
});
