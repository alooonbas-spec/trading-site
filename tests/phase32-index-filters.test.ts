import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCampaignStatusFilter } from "@/lib/campaigns/filters";
import { parsePostStatusFilter } from "@/lib/posts/filters";
import {
  parseMonitoringPlatformFilter,
  parseMonitoringStatusFilter,
} from "@/lib/monitoring/filters";

describe("index list filters", () => {
  it("accepts known statuses and ignores invented values", () => {
    expect(parseCampaignStatusFilter("RUNNING")).toBe("RUNNING");
    expect(parseCampaignStatusFilter("not-a-status")).toBeUndefined();
    expect(parsePostStatusFilter("PARTIAL")).toBe("PARTIAL");
    expect(parsePostStatusFilter("SUCCESS")).toBeUndefined();
    expect(parseMonitoringStatusFilter("PAUSED")).toBe("PAUSED");
    expect(parseMonitoringStatusFilter("FAILED")).toBeUndefined();
    expect(parseMonitoringPlatformFilter("vk")).toBe("vk");
    expect(parseMonitoringPlatformFilter("threads")).toBeUndefined();
  });
});

describe("PHASE 32 index status filters", () => {
  it("filters campaign, post, and monitoring index queries without OFFSET or platform switches", () => {
    const campaigns = readFileSync("services/campaigns/campaign-service.ts", "utf8");
    const posts = readFileSync("services/posts/post-service.ts", "utf8");
    const monitoring = readFileSync("services/monitoring/rule-service.ts", "utf8");

    expect(campaigns).toContain("options?.status");
    expect(posts).toContain("options?.status");
    expect(monitoring).toContain("options?.status");
    expect(monitoring).toContain("options?.platform");
    for (const source of [campaigns, posts, monitoring]) {
      expect(source).toContain("parseKeysetCursor");
      expect(source).not.toMatch(/offset\(/i);
      expect(source).not.toMatch(/if\s*\(\s*platform\s*===/);
    }
    expect(campaigns).not.toContain("do_not_contact");
    expect(posts).not.toContain("do_not_contact");
    expect(monitoring).not.toContain("do_not_contact");
  });

  it("exposes GET status filters that omit after and keep created_at keyset copy", () => {
    const campaignsPage = readFileSync("app/(dashboard)/w/[workspaceId]/campaigns/page.tsx", "utf8");
    const postsPage = readFileSync("app/(dashboard)/w/[workspaceId]/posts/page.tsx", "utf8");
    const monitoringPage = readFileSync("app/(dashboard)/w/[workspaceId]/monitoring/page.tsx", "utf8");

    for (const page of [campaignsPage, postsPage, monitoringPage]) {
      expect(page).toContain('name="status"');
      expect(page).not.toContain('name="after"');
      expect(page).toContain("filterQuery");
      expect(page).toContain("created_at keyset");
      expect(page).toContain("ListPagination");
      expect(page).not.toMatch(/if\s*\(\s*platform\s*===/);
    }
    expect(monitoringPage).toContain('name="platform"');
    expect(monitoringPage).toContain("rule identity");
  });
});
