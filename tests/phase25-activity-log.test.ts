import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { workspaceNav } from "@/config/navigation";
import {
  ACTIVITY_ACTION_FILTERS,
  ACTIVITY_ENTITY_TYPE_FILTERS,
  parseActivityAccountIdFilter,
  parseActivityActionFilter,
  parseActivityEntityTypeFilter,
  parseActivityPlatformFilter,
} from "@/lib/activity/filters";
import { activityEntityHref } from "@/lib/activity/links";
import { logger } from "@/lib/logger";
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES } from "@/types/activity";

describe("activity filters", () => {
  it("parses action, entity, account, and platform without inventing values", () => {
    expect(parseActivityActionFilter("JOB_RETRIED")).toBe("JOB_RETRIED");
    expect(parseActivityActionFilter("INBOX_REPLIED")).toBe("INBOX_REPLIED");
    expect(parseActivityActionFilter("all")).toBeUndefined();
    expect(parseActivityActionFilter("DELETE_EVERYTHING")).toBeUndefined();
    expect(ACTIVITY_ACTION_FILTERS).toEqual(["all", ...ACTIVITY_ACTIONS]);

    expect(parseActivityEntityTypeFilter("job")).toBe("job");
    expect(parseActivityEntityTypeFilter("inbox_event")).toBe("inbox_event");
    expect(parseActivityEntityTypeFilter("all")).toBeUndefined();
    expect(parseActivityEntityTypeFilter("secret")).toBeUndefined();
    expect(ACTIVITY_ENTITY_TYPE_FILTERS).toEqual(["all", ...ACTIVITY_ENTITY_TYPES]);

    expect(parseActivityPlatformFilter("vk")).toBe("vk");
    expect(parseActivityPlatformFilter("myspace")).toBeUndefined();

    expect(parseActivityAccountIdFilter("11111111-1111-4111-8111-111111111111")).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(parseActivityAccountIdFilter("not-a-uuid")).toBeUndefined();
  });
});

describe("activity entity links", () => {
  it("links known entities and ignores unknown types", () => {
    expect(activityEntityHref("ws-1", "lead", "lead-1")).toBe("/w/ws-1/leads/lead-1");
    expect(activityEntityHref("ws-1", "campaign", "c-1")).toBe("/w/ws-1/campaigns/c-1");
    expect(activityEntityHref("ws-1", "post", "p-1")).toBe("/w/ws-1/posts/p-1");
    expect(activityEntityHref("ws-1", "monitoring_rule", "r-1")).toBe("/w/ws-1/monitoring/r-1");
    expect(activityEntityHref("ws-1", "job", "j-1")).toBe("/w/ws-1/jobs");
    expect(activityEntityHref("ws-1", "inbox_event", "i-1")).toBe("/w/ws-1/inbox");
    expect(activityEntityHref("ws-1", "social_account", "a-1")).toBe("/w/ws-1/social-accounts");
    expect(activityEntityHref("ws-1", "unknown", "x")).toBeNull();
    expect(activityEntityHref("ws-1", "lead", null)).toBeNull();
  });
});

describe("PHASE 25 activity log", () => {
  it("lists activity with redacted metadata and no platform business switch", () => {
    const query = readFileSync("services/activity/query-service.ts", "utf8");
    expect(query).toContain("listWorkspaceActivity");
    expect(query).toContain("logger.redact");
    expect(query).toContain('request.eq("action", input.action)');
    expect(query).toContain('request.eq("entity_type", input.entityType)');
    expect(query).toContain('request.eq("social_account_id", input.socialAccountId)');
    expect(query).toContain('request.eq("platform", input.platform)');
    expect(query).not.toMatch(/platform\s*===\s*["']telegram["']/);
    expect(query).not.toMatch(/if\s*\(\s*platform\s*===/);
    expect(query).not.toContain("do_not_contact");
    expect(query).not.toContain(".update(");
  });

  it("exposes the Activity page from nav and dashboard", () => {
    const page = readFileSync("app/(dashboard)/w/[workspaceId]/activity/page.tsx", "utf8");
    const dashboard = readFileSync("app/(dashboard)/w/[workspaceId]/page.tsx", "utf8");
    const nav = workspaceNav("ws-1");

    expect(nav.some((item) => item.href === "/w/ws-1/activity" && item.title === "Activity")).toBe(true);
    expect(page).toContain('name="action"');
    expect(page).toContain('name="entity"');
    expect(page).toContain('name="account"');
    expect(page).toContain('name="platform"');
    expect(page).toContain("Tokens and secrets never");
    expect(page).toContain("does not rewrite LeadStatus or do_not_contact");
    expect(dashboard).toContain('href={`/w/${workspaceId}/activity`}');
  });

  it("redacts token-like activity metadata before display", () => {
    const redacted = logger.redact({
      type: "CONTACT",
      access_token: "should-not-leak",
      apiKey: "nope",
    });
    expect(redacted.type).toBe("CONTACT");
    expect(redacted.access_token).toBe("[redacted]");
    expect(redacted.apiKey).toBe("[redacted]");
  });
});
