import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("foundation migration", () => {
  const sql = readFileSync("supabase/migrations/20260821100000_phase1_foundation.sql", "utf8");

  it("enables RLS on every PHASE 1 table", () => {
    for (const table of ["profiles", "workspaces", "workspace_members", "activity_log"]) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`alter table public.${table} force row level security`);
    }
  });

  it("keeps membership unique per workspace", () => {
    expect(sql).toContain("unique (workspace_id, user_id)");
  });

  it("indexes tenant and membership lookup columns", () => {
    expect(sql).toContain("idx_workspace_members_workspace_id");
    expect(sql).toContain("idx_workspace_members_user_id");
    expect(sql).toContain("idx_activity_log_workspace_id");
    expect(sql).toContain("idx_activity_log_created_at");
  });
});
