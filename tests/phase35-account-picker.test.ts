import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_PICKER_QUERY_MAX,
  sanitizeAccountPickerQuery,
  toPickerAccount,
  withSelectedPickerAccount,
} from "@/lib/social-accounts/picker";

describe("social account picker query", () => {
  it("trims, caps length, maps public picker fields, and keeps a selected account", () => {
    expect(sanitizeAccountPickerQuery("  brand_bot  ")).toBe("brand_bot");
    expect(sanitizeAccountPickerQuery("   ")).toBeUndefined();
    expect(sanitizeAccountPickerQuery("x".repeat(ACCOUNT_PICKER_QUERY_MAX + 20))?.length).toBe(
      ACCOUNT_PICKER_QUERY_MAX,
    );
    expect(
      toPickerAccount({
        id: "11111111-1111-4111-8111-111111111111",
        workspaceId: "w",
        platform: "telegram",
        externalAccountId: "42",
        username: "@hub",
        displayName: "Hub",
        avatarUrl: null,
        status: "CONNECTED",
        scopes: ["bot"],
        tokenExpiresAt: null,
        lastSyncAt: null,
        lastError: "secret-ish",
        lastErrorAt: null,
        createdAt: "2026-08-21T00:00:00.000Z",
        updatedAt: "2026-08-21T00:00:00.000Z",
      }),
    ).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      platform: "telegram",
      username: "@hub",
      displayName: "Hub",
      externalAccountId: "42",
      avatarUrl: null,
      status: "CONNECTED",
    });
    const selected = {
      id: "22222222-2222-4222-8222-222222222222",
      platform: "vk" as const,
      username: "group",
      displayName: null,
      externalAccountId: "1",
      avatarUrl: null,
      status: "CONNECTED" as const,
    };
    expect(withSelectedPickerAccount([], selected)).toEqual([selected]);
    expect(withSelectedPickerAccount([selected], selected)).toEqual([selected]);
  });
});

describe("PHASE 35 searchable social account pickers", () => {
  it("searches a 200-row account page instead of unbounded listSocialAccounts in compose and filters", () => {
    const service = readFileSync("services/social-accounts/account-service.ts", "utf8");
    const action = readFileSync("app/actions/social-accounts.ts", "utf8");
    const selector = readFileSync("components/social-accounts/social-account-selector.tsx", "utf8");
    const campaignForm = readFileSync("components/campaigns/create-campaign-form.tsx", "utf8");
    const postForm = readFileSync("components/posts/create-post-form.tsx", "utf8");
    const groupForm = readFileSync("components/social-accounts/create-group-form.tsx", "utf8");
    const monitoringForm = readFileSync("components/monitoring/create-monitoring-rule-form.tsx", "utf8");
    const campaignsPage = readFileSync("app/(dashboard)/w/[workspaceId]/campaigns/page.tsx", "utf8");
    const postsPage = readFileSync("app/(dashboard)/w/[workspaceId]/posts/page.tsx", "utf8");
    const monitoringPage = readFileSync("app/(dashboard)/w/[workspaceId]/monitoring/page.tsx", "utf8");
    const accountsPage = readFileSync("app/(dashboard)/w/[workspaceId]/social-accounts/page.tsx", "utf8");
    const jobsPage = readFileSync("app/(dashboard)/w/[workspaceId]/jobs/page.tsx", "utf8");
    const activityPage = readFileSync("app/(dashboard)/w/[workspaceId]/activity/page.tsx", "utf8");
    const inboxPage = readFileSync("app/(dashboard)/w/[workspaceId]/inbox/page.tsx", "utf8");
    const leadPage = readFileSync("app/(dashboard)/w/[workspaceId]/leads/[leadId]/page.tsx", "utf8");

    expect(service).toContain("searchPickerAccounts");
    expect(service).toContain("listSocialAccountsPage");
    expect(service).toContain("username.ilike");
    expect(service).toContain("sanitizeAccountPickerQuery");
    expect(action).toContain("searchPickerAccountsAction");
    expect(action).toContain("toPickerAccount");

    expect(selector).toContain("searchPickerAccountsAction");
    expect(selector).toContain("startTransition");
    expect(selector).toContain("ACCOUNT_PICKER_LIMIT_HINT");
    expect(selector).toContain('type="button"');
    expect(selector).not.toMatch(/if\s*\(\s*platform\s*===/);

    expect(campaignForm).toContain("SocialAccountSelector");
    expect(postForm).toContain("SocialAccountSelector");
    expect(groupForm).toContain("SocialAccountSelector");
    expect(monitoringForm).toContain("searchPickerAccountsAction");
    expect(monitoringForm).toContain("ACCOUNT_PICKER_LIMIT_HINT");
    expect(monitoringForm).toContain("account identity");

    for (const page of [campaignsPage, postsPage, monitoringPage, accountsPage, jobsPage, activityPage, inboxPage, leadPage]) {
      expect(page).toContain("searchPickerAccounts");
      expect(page).not.toContain("listSocialAccounts(");
      expect(page).not.toMatch(/if\s*\(\s*platform\s*===/);
    }

    expect(jobsPage).toContain('name="accountQ"');
    expect(jobsPage).not.toContain('name="after"');
    expect(jobsPage).toContain("ACCOUNT_PICKER_LIMIT_HINT");
    expect(activityPage).toContain('name="accountQ"');
    expect(activityPage).not.toContain('name="after"');
    expect(inboxPage).toContain('name="accountQ"');
    expect(inboxPage).toContain("ACCOUNT_PICKER_LIMIT_HINT");
    expect(leadPage).toContain('name="accountQ"');
    expect(leadPage).toContain("listSocialAccountsByIds");
    expect(leadPage).toContain("do_not_contact");
  });
});
