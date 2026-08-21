import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { statusCount, sumCounts, tallyByStatus } from "@/lib/analytics/tally";
import { daysAgoUtc, startOfUtcDay } from "@/lib/analytics/window";
import {
  CONTACT_STATUSES,
  JOB_STATUSES,
  LEAD_STATUSES,
  MONITORING_RULE_STATUSES,
} from "@/types/status";

describe("analytics tally", () => {
  it("keeps lead and contact status counts on separate machines", () => {
    const leads = tallyByStatus(LEAD_STATUSES, ["NEW", "CUSTOMER", "NEW"]);
    const contacts = tallyByStatus(CONTACT_STATUSES, ["REPLIED", "MESSAGE_SENT"]);

    expect(statusCount(leads, "NEW")).toBe(2);
    expect(statusCount(leads, "CUSTOMER")).toBe(1);
    expect(statusCount(leads, "DO_NOT_CONTACT")).toBe(0);
    expect(LEAD_STATUSES).not.toContain("MESSAGE_SENT");
    expect(CONTACT_STATUSES).not.toContain("DO_NOT_CONTACT");
    expect(statusCount(contacts, "REPLIED")).toBe(1);
    expect(sumCounts(leads)).toBe(3);
    expect(sumCounts(contacts)).toBe(2);
  });

  it("does not fold job families into one success total", () => {
    const contactJobs = tallyByStatus(JOB_STATUSES, ["SUCCESS", "FAILED"]);
    const publishJobs = tallyByStatus(JOB_STATUSES, ["SUCCESS"]);
    const monitorJobs = tallyByStatus(JOB_STATUSES, ["PENDING"]);
    expect(statusCount(contactJobs, "SUCCESS")).toBe(1);
    expect(statusCount(publishJobs, "SUCCESS")).toBe(1);
    expect(statusCount(monitorJobs, "SUCCESS")).toBe(0);
    expect(statusCount(contactJobs, "SUCCESS") + statusCount(publishJobs, "SUCCESS")).not.toBe(
      statusCount(contactJobs, "SUCCESS"),
    );
  });

  it("fills zero counts for unused monitoring statuses", () => {
    const rules = tallyByStatus(MONITORING_RULE_STATUSES, ["ACTIVE"]);
    expect(rules).toEqual([
      { status: "ACTIVE", count: 1 },
      { status: "PAUSED", count: 0 },
      { status: "DISABLED", count: 0 },
    ]);
  });
});

describe("analytics windows", () => {
  it("uses UTC day boundaries", () => {
    const now = new Date("2026-08-21T13:37:00.000Z");
    expect(startOfUtcDay(now).toISOString()).toBe("2026-08-21T00:00:00.000Z");
    expect(daysAgoUtc(6, now).toISOString()).toBe("2026-08-15T00:00:00.000Z");
  });
});

describe("PHASE 8 source boundaries", () => {
  it("does not mix metric families in the analytics service", () => {
    const service = readFileSync("services/analytics/analytics-service.ts", "utf8");
    expect(service).toContain("tallyByStatus(LEAD_STATUSES");
    expect(service).toContain("tallyByStatus(CONTACT_STATUSES");
    expect(service).toContain("tallyByStatus(CAMPAIGN_STATUSES");
    expect(service).toContain("tallyByStatus(SOCIAL_ACCOUNT_STATUSES");
    expect(service).toContain("tallyByStatus(POST_STATUSES");
    expect(service).toContain("tallyByStatus(MONITORING_RULE_STATUSES");
    expect(service).toContain('eq("type", "CONTACT")');
    expect(service).not.toMatch(/platform\s*===\s*["']telegram["']/);
    expect(service).not.toMatch(/do_not_contact boolean/);
  });

  it("does not add an analytics table with do_not_contact", () => {
    const files = [
      "supabase/migrations/20260821100000_phase1_foundation.sql",
      "supabase/migrations/20260821120000_phase2_social_accounts.sql",
      "supabase/migrations/20260821140000_phase3_crm.sql",
      "supabase/migrations/20260821160000_phase4_campaigns.sql",
      "supabase/migrations/20260821180000_phase5_tinyfish.sql",
      "supabase/migrations/20260821200000_phase6_posts.sql",
      "supabase/migrations/20260821220000_phase7_monitoring.sql",
    ];
    for (const file of files) {
      const sql = readFileSync(file, "utf8");
      if (file.includes("phase3_crm")) {
        expect(sql).toMatch(/do_not_contact boolean not null default false/);
        continue;
      }
      const withoutComments = sql
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n");
      expect(withoutComments).not.toMatch(/do_not_contact boolean/);
    }
  });
});
