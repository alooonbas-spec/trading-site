import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_STATUSES,
  CONTACT_STATUSES,
  JOB_STATUSES,
  LEAD_STATUSES,
  POST_STATUSES,
  POST_TARGET_STATUSES,
  SOCIAL_ACCOUNT_STATUSES,
  MONITORING_RULE_STATUSES,
} from "@/types/status";

describe("independent state machines", () => {
  it("keeps lead status as CRM stages only", () => {
    expect(LEAD_STATUSES).toContain("INTERESTED");
    expect(LEAD_STATUSES).toContain("DO_NOT_CONTACT");
    expect(LEAD_STATUSES).not.toContain("MESSAGE_SENT");
    expect(LEAD_STATUSES).not.toContain("INVITED");
    expect(LEAD_STATUSES).not.toContain("REPLIED");
  });

  it("keeps contact status as relationship state and omits do_not_contact", () => {
    expect(CONTACT_STATUSES).toContain("MESSAGE_SENT");
    expect(CONTACT_STATUSES).toContain("REPLIED");
    expect(CONTACT_STATUSES).not.toContain("DO_NOT_CONTACT");
    expect(CONTACT_STATUSES).not.toContain("INTERESTED");
  });

  it("does not reuse one universal status union", () => {
    const lead = new Set<string>(LEAD_STATUSES);
    const contact = new Set<string>(CONTACT_STATUSES);
    const campaign = new Set<string>(CAMPAIGN_STATUSES);
    const job = new Set<string>(JOB_STATUSES);
    const account = new Set<string>(SOCIAL_ACCOUNT_STATUSES);

    expect([...lead].some((value) => contact.has(value))).toBe(false);
    expect(campaign.has("RUNNING")).toBe(true);
    expect(job.has("SUCCESS")).toBe(true);
    expect(account.has("CONNECTED")).toBe(true);
    expect(campaign.has("MESSAGE_SENT")).toBe(false);
    expect(account.has("INTERESTED")).toBe(false);
    expect(POST_STATUSES).not.toContain("MESSAGE_SENT");
    expect(POST_TARGET_STATUSES).not.toContain("DO_NOT_CONTACT");
    expect(MONITORING_RULE_STATUSES).not.toContain("DO_NOT_CONTACT");
    expect(MONITORING_RULE_STATUSES).not.toContain("SUCCESS");
  });
});

describe("do_not_contact source of truth", () => {
  it("does not appear on PHASE 1 tables", () => {
    const sql = readFileSync(
      "supabase/migrations/20260821100000_phase1_foundation.sql",
      "utf8",
    );

    expect(sql).toMatch(/create table public\.workspaces/i);
    expect(sql).toMatch(/create table public\.workspace_members/i);
    expect(sql).toMatch(/create table public\.activity_log/i);
    const columnLines = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");

    expect(columnLines).not.toMatch(/\bdo_not_contact\b/i);
  });
});
