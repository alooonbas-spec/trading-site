import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("PHASE 3 CRM migration", () => {
  const sql = readFileSync("supabase/migrations/20260821140000_phase3_crm.sql", "utf8");
  const withoutComments = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  it("places do_not_contact only on leads", () => {
    expect((withoutComments.match(/do_not_contact boolean/g) ?? []).length).toBe(1);
    expect(sql).toContain("idx_leads_do_not_contact");
    expect(sql).not.toContain("idx_social_profiles_do_not_contact");
    expect(sql).not.toContain("idx_contact_relationships_do_not_contact");
  });

  it("keeps social profiles unique per workspace platform identity", () => {
    expect(sql).toContain("unique (workspace_id, platform, external_profile_id)");
  });

  it("keeps contact relationships unique per profile and our account", () => {
    expect(sql).toContain("unique (social_profile_id, social_account_id)");
  });

  it("enables RLS on every PHASE 3 table", () => {
    for (const table of ["leads", "social_profiles", "contact_relationships", "lead_interactions"]) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`alter table public.${table} force row level security`);
    }
  });

  it("lets operators mutate CRM data while viewers stay read-only", () => {
    expect(sql).toContain("array['OWNER', 'ADMIN', 'OPERATOR']::public.workspace_role[]");
    expect(sql).toContain("create policy leads_select");
  });
});
