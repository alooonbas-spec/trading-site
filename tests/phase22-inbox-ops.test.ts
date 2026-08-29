import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  INBOX_REPLY_KIND_FILTERS,
  parseInboxAccountIdFilter,
  parseInboxMatchFilter,
  parseInboxPlatformFilter,
  parseInboxReplyKindFilter,
} from "@/lib/inbox/filters";
import { INBOX_MATCH_FILTERS } from "@/types/inbox";

describe("inbox operator filters", () => {
  it("parses match, account, platform, and stored reply kind without inventing values", () => {
    expect(parseInboxMatchFilter("unmatched")).toBe("unmatched");
    expect(parseInboxMatchFilter("nope")).toBe("all");
    expect(INBOX_MATCH_FILTERS).toEqual(["all", "unmatched", "matched"]);

    expect(parseInboxReplyKindFilter("direct_message")).toBe("direct_message");
    expect(parseInboxReplyKindFilter("comment")).toBe("comment");
    expect(parseInboxReplyKindFilter("mention")).toBe("mention");
    expect(parseInboxReplyKindFilter("all")).toBeUndefined();
    expect(parseInboxReplyKindFilter("dm")).toBeUndefined();
    expect(INBOX_REPLY_KIND_FILTERS).toEqual(["all", "direct_message", "comment", "mention"]);

    expect(parseInboxPlatformFilter("telegram")).toBe("telegram");
    expect(parseInboxPlatformFilter("myspace")).toBeUndefined();

    expect(parseInboxAccountIdFilter("11111111-1111-4111-8111-111111111111")).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(parseInboxAccountIdFilter("not-a-uuid")).toBeUndefined();
    expect(parseInboxAccountIdFilter("")).toBeUndefined();
  });
});

describe("PHASE 22 inbox operations", () => {
  it("filters inbox events in SQL by account, platform, and stored reply_kind", () => {
    const query = readFileSync("services/inbox/query-service.ts", "utf8");
    expect(query).toContain("resolveInboxAccountIds");
    expect(query).toContain('request.eq("reply_kind", input.replyKind)');
    expect(query).toContain(".eq(\"platform\", platform)");
    expect(query).not.toMatch(/platform\s*===\s*["']telegram["']/);
  });

  it("polls inbox-capable accounts through adapter capabilities, not a platform switch", () => {
    const service = readFileSync("services/social-accounts/account-service.ts", "utf8");
    expect(service).toContain("startWorkspaceInboxPolling");
    expect(service).toContain("getSocialAdapter(account.platform)");
    expect(service).toContain("getCapabilities()).inbox");
    expect(service).toContain('account.status === "DISCONNECTED"');
    expect(service).not.toMatch(/if\s*\(\s*platform\s*===\s*["']telegram["']/);
  });

  it("exposes poll and shared-queue processing on the Inbox page", () => {
    const page = readFileSync("app/(dashboard)/w/[workspaceId]/inbox/page.tsx", "utf8");
    const controls = readFileSync("components/inbox/inbox-controls.tsx", "utf8");
    expect(page).toContain('name="account"');
    expect(page).toContain('name="platform"');
    expect(page).toContain('name="kind"');
    expect(page).toContain("never creates people automatically");
    expect(page).toContain("Kind filter uses stored reply_kind from collection");
    expect(controls).toContain("startWorkspaceInboxPollingAction");
    expect(controls).toContain("processInboxQueueAction");
    expect(controls).toContain("Poll inbox");
    expect(controls).toContain("Process queue");
    expect(controls).toContain("not only INBOX jobs");
  });

  it("keeps unmatched open and outbound replies as separate inbox metrics", () => {
    const types = readFileSync("types/analytics.ts", "utf8");
    const service = readFileSync("services/analytics/analytics-service.ts", "utf8");
    const page = readFileSync("app/(dashboard)/w/[workspaceId]/analytics/page.tsx", "utf8");
    expect(types).toContain("unmatchedOpen");
    expect(types).toContain("repliesToday");
    expect(service).toContain('eq("matched", false)');
    expect(service).toContain('eq("action", "INBOX_REPLIED")');
    expect(service).not.toMatch(/eventsToday \+ matchedToday/);
    expect(page).toContain("Unmatched open");
    expect(page).toContain("Replies today");
    expect(page).toContain("counted separately from inbound events");
  });
});
