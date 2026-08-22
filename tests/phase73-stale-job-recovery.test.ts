import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("PHASE 73 stale job recovery migration", () => {
  const sql = readFileSync("supabase/migrations/20260822100000_phase73_stale_job_recovery.sql", "utf8");
  const withoutComments = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  it("does not add do_not_contact", () => {
    expect(withoutComments).not.toMatch(/do_not_contact/);
  });

  it("reclaims stale RUNNING jobs with attempts left, in both claim_jobs and claim_due_jobs", () => {
    const staleClause = "j.status = 'RUNNING'\n          and j.locked_at < now() - interval '15 minutes'\n          and j.attempts < j.max_attempts";
    expect(sql.match(new RegExp(staleClause.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))?.length).toBe(2);
  });

  it("keeps the original PENDING/RETRY claim path alongside the stale reclaim", () => {
    expect(sql.match(/j\.status in \('PENDING', 'RETRY'\)/g)?.length).toBe(2);
  });

  it("still claims with skip locked and restricts claim_due_jobs to service_role", () => {
    expect(sql).toContain("for update of j skip locked");
    expect(sql).toContain("private.is_service_role()");
    expect(sql).toContain("grant execute on function public.claim_due_jobs(integer, text) to service_role");
    expect(sql).not.toContain("grant execute on function public.claim_due_jobs(integer, text) to authenticated");
  });

  it("keeps claim_jobs scoped to a single workspace", () => {
    expect(sql).toContain("j.workspace_id = p_workspace_id");
  });

  it("still increments attempts and clears last_error on every claim, including stale reclaims", () => {
    expect(sql.match(/attempts = job\.attempts \+ 1/g)?.length).toBe(2);
    expect(sql.match(/last_error = null/g)?.length).toBe(2);
  });
});
