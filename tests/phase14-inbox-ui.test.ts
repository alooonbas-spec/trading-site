import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  inboxEventToMessage,
  inboxUsernameForProfile,
  normalizeInboxIdentity,
  resolveInboxProfileLink,
  unmatchedInboxEventsForProfile,
} from "@/lib/inbox/match-profile";
import { attachInboxEventSchema } from "@/lib/validation/lead";
import { ACTIVITY_ACTIONS } from "@/types/activity";
import { INBOX_MATCH_FILTERS } from "@/types/inbox";

describe("inbox attach identity", () => {
  it("creates a profile when the sender is unknown", () => {
    expect(
      resolveInboxProfileLink(
        [{ leadId: "lead-1", externalProfileId: "99", username: "other" }],
        { externalProfileId: "42", username: "@alice" },
        "lead-1",
      ),
    ).toEqual({ kind: "create" });
  });

  it("reuses a profile already linked to the selected lead", () => {
    expect(
      resolveInboxProfileLink(
        [{ leadId: "lead-1", externalProfileId: "leaduser", username: "@LeadUser" }],
        { externalProfileId: "42", username: "@leaduser" },
        "lead-1",
      ),
    ).toEqual({ kind: "reuse", leadId: "lead-1" });
  });

  it("refuses a profile already linked to another lead", () => {
    expect(
      resolveInboxProfileLink(
        [{ leadId: "lead-other", externalProfileId: "42", username: null }],
        { externalProfileId: "42", username: "@alice" },
        "lead-1",
      ),
    ).toEqual({ kind: "conflict", leadId: "lead-other" });
  });

  it("rematches unmatched sibling events by numeric id or username", () => {
    const siblings = unmatchedInboxEventsForProfile(
      [
        {
          matched: false,
          platform: "telegram",
          externalProfileId: "42",
          username: "@alice",
        },
        {
          matched: false,
          platform: "telegram",
          externalProfileId: "alice",
          username: null,
        },
        {
          matched: false,
          platform: "x",
          externalProfileId: "42",
          username: "@alice",
        },
        {
          matched: true,
          platform: "telegram",
          externalProfileId: "42",
          username: "@alice",
        },
        {
          matched: false,
          platform: "telegram",
          externalProfileId: "99",
          username: "@other",
        },
      ],
      "telegram",
      { externalProfileId: "42", username: "alice" },
    );

    expect(siblings).toHaveLength(2);
    expect(siblings.map((item) => item.externalProfileId)).toEqual(["42", "alice"]);
  });

  it("stores profile usernames without a leading @", () => {
    expect(inboxUsernameForProfile("@LeadUser")).toBe("LeadUser");
    expect(inboxUsernameForProfile("  ")).toBeUndefined();
    expect(normalizeInboxIdentity("@LeadUser")).toBe("leaduser");
    expect(
      inboxEventToMessage({
        externalId: "1",
        externalProfileId: "42",
        username: "@alice",
        body: "Hi",
        url: null,
        receivedAt: null,
      }).username,
    ).toBe("@alice");
  });
});

describe("PHASE 14 inbox UI boundaries", () => {
  it("validates attach payloads and keeps unmatched as a first-class filter", () => {
    expect(INBOX_MATCH_FILTERS).toEqual(["all", "unmatched", "matched"]);
    expect(ACTIVITY_ACTIONS).toContain("INBOX_ATTACHED");
    expect(attachInboxEventSchema.safeParse({ inboxEventId: "not-a-uuid", leadId: "also-bad" }).success).toBe(
      false,
    );
    expect(
      attachInboxEventSchema.safeParse({
        inboxEventId: "11111111-1111-4111-8111-111111111111",
        leadId: "22222222-2222-4222-8222-222222222222",
      }).success,
    ).toBe(true);
  });

  it("attaches unmatched senders to existing leads without auto-creating people", () => {
    const attach = readFileSync("services/inbox/attach-service.ts", "utf8");
    const ingest = readFileSync("services/inbox/ingest-service.ts", "utf8");
    const page = readFileSync("app/(dashboard)/w/[workspaceId]/inbox/page.tsx", "utf8");
    const sql = readFileSync("supabase/migrations/20260821280000_phase14_inbox_ui.sql", "utf8");
    const withoutComments = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");

    expect(attach).toContain("createSocialProfile");
    expect(attach).not.toMatch(/from\("leads"\)\s*\.insert/);
    expect(ingest).not.toMatch(/from\("leads"\)\s*\.insert/);
    expect(page).toContain("never creates people automatically");
    expect(attach).toContain("This social identity is already linked to another lead");
    expect(attach).toContain("recordInboxReply");
    expect(withoutComments).not.toMatch(/do_not_contact boolean/);
    expect(sql).toContain("idx_inbox_events_workspace_unmatched");
    expect(sql).toContain("where social_profile_id is null");
  });

  it("keeps merge and navigation honest about inbox events", () => {
    const merge = readFileSync("services/leads/merge-service.ts", "utf8");
    const nav = readFileSync("config/navigation.ts", "utf8");
    expect(merge).toContain('from("inbox_events")');
    expect(merge).toContain("lead_id: target.id");
    expect(nav).toContain('title: "Inbox"');
    expect(nav).toContain("/inbox");
  });
});
