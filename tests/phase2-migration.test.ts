import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("PHASE 2 social accounts migration", () => {
  const sql = readFileSync("supabase/migrations/20260821120000_phase2_social_accounts.sql", "utf8");

  it("enforces one external account per platform inside a workspace", () => {
    expect(sql).toContain("unique (workspace_id, platform, external_account_id)");
  });

  it("does not add do_not_contact to account tables", () => {
    const withoutComments = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(withoutComments).not.toMatch(/do_not_contact/);
  });

  it("enables RLS on every PHASE 2 table", () => {
    for (const table of ["social_accounts", "account_groups", "account_group_members", "oauth_states"]) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`alter table public.${table} force row level security`);
    }
  });

  it("hides encrypted tokens from authenticated SELECT", () => {
    expect(sql).toContain("revoke all on public.social_accounts from anon, authenticated");
    expect(sql).toContain("grant select (");
    expect(sql).not.toMatch(/grant select \([^)]*access_token_encrypted/);
    expect(sql).not.toMatch(/grant select \([^)]*refresh_token_encrypted/);
    expect(sql).toContain("read_social_account_secrets");
    expect(sql).toContain("security definer");
  });

  it("keeps oauth state at least 32 characters with a 10 minute TTL in application code", () => {
    expect(sql).toContain("check (char_length(state) >= 32)");
  });
});
