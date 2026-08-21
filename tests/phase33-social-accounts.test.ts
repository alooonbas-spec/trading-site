import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parseSocialAccountPlatformFilter,
  parseSocialAccountStatusFilter,
} from "@/lib/social-accounts/filters";

function unboundedListBody(source: string, exportName: string, nextExportName: string): string {
  const start = source.indexOf(`export async function ${exportName}`);
  const end = source.indexOf(`export async function ${nextExportName}`, start + 1);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("social account index filters", () => {
  it("accepts known statuses and platforms and ignores invented values", () => {
    expect(parseSocialAccountStatusFilter("CONNECTED")).toBe("CONNECTED");
    expect(parseSocialAccountStatusFilter("SUCCESS")).toBeUndefined();
    expect(parseSocialAccountPlatformFilter("telegram")).toBe("telegram");
    expect(parseSocialAccountPlatformFilter("threads")).toBeUndefined();
  });
});

describe("PHASE 33 social account pagination", () => {
  it("pages account health with created_at keysets and keeps picker listSocialAccounts unbounded", () => {
    const service = readFileSync("services/social-accounts/account-service.ts", "utf8");
    expect(unboundedListBody(service, "listSocialAccounts", "listSocialAccountsPage")).not.toContain(
      ".limit(",
    );
    expect(service).toContain("listSocialAccountsPage");
    expect(service).toContain("listSocialAccountHealthPage");
    expect(service).toContain("SOCIAL_ACCOUNT_PAGE_SIZE + 1");
    expect(service).toContain("parseKeysetCursor");
    expect(service).toContain("keysetOrFilter");
    expect(service).not.toMatch(/offset\(/i);
    expect(service).not.toContain("do_not_contact");
  });

  it("filters the Social Accounts page without loading picker accounts through the keyset", () => {
    const page = readFileSync("app/(dashboard)/w/[workspaceId]/social-accounts/page.tsx", "utf8");
    expect(page).toContain("listSocialAccountHealthPage");
    expect(page).toContain("listSocialAccounts(workspaceId)");
    expect(page).toContain("ListPagination");
    expect(page).toContain("created_at keyset");
    expect(page).toContain('name="platform"');
    expect(page).toContain('name="status"');
    expect(page).not.toContain('name="after"');
    expect(page).toContain("account identity");
  });
});
