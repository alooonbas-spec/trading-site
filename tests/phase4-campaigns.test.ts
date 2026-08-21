import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("PHASE 4 campaigns migration", () => {
  const sql = readFileSync("supabase/migrations/20260821160000_phase4_campaigns.sql", "utf8");
  const withoutComments = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  it("does not add do_not_contact to campaign or job tables", () => {
    expect(withoutComments).not.toMatch(/do_not_contact boolean/);
  });

  it("claims jobs with skip locked", () => {
    expect(sql).toContain("for update of j skip locked");
    expect(sql).toContain("claim_jobs");
  });

  it("stores per-account rate-limit windows", () => {
    expect(sql).toContain("account_rate_buckets");
    expect(sql).toContain("increment_account_rate_bucket");
  });

  it("enables RLS on campaign and job tables", () => {
    for (const table of ["campaigns", "campaign_leads", "campaign_accounts", "jobs", "account_rate_buckets"]) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`alter table public.${table} force row level security`);
    }
  });
});
