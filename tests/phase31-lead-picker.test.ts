import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sanitizePickerQuery, toPickerLead, LEAD_PICKER_QUERY_MAX } from "@/lib/leads/picker";

describe("lead picker query", () => {
  it("trims, caps length, and maps only public picker fields", () => {
    expect(sanitizePickerQuery("  alice  ")).toBe("alice");
    expect(sanitizePickerQuery("   ")).toBeUndefined();
    expect(sanitizePickerQuery("x".repeat(LEAD_PICKER_QUERY_MAX + 20))?.length).toBe(LEAD_PICKER_QUERY_MAX);
    expect(
      toPickerLead({
        id: "11111111-1111-4111-8111-111111111111",
        workspaceId: "w",
        displayName: "Alice",
        email: "a@example.com",
        phone: "+1",
        notes: "secret-ish",
        status: "NEW",
        doNotContact: true,
        mergedIntoId: null,
        createdBy: null,
        createdAt: "2026-08-21T00:00:00.000Z",
        updatedAt: "2026-08-21T00:00:00.000Z",
        profileCount: 1,
      }),
    ).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      displayName: "Alice",
      email: "a@example.com",
      doNotContact: true,
    });
  });
});

describe("PHASE 31 searchable lead pickers", () => {
  it("uses a 200-row picker search instead of unbounded listLeads in campaign, inbox, and merge", () => {
    const service = readFileSync("services/leads/lead-service.ts", "utf8");
    const action = readFileSync("app/actions/leads.ts", "utf8");
    const campaignForm = readFileSync("components/campaigns/create-campaign-form.tsx", "utf8");
    const campaignsPage = readFileSync("app/(dashboard)/w/[workspaceId]/campaigns/page.tsx", "utf8");
    const inboxPage = readFileSync("app/(dashboard)/w/[workspaceId]/inbox/page.tsx", "utf8");
    const leadPage = readFileSync("app/(dashboard)/w/[workspaceId]/leads/[leadId]/page.tsx", "utf8");

    expect(service).toContain("searchPickerLeads");
    expect(service).toContain("listLeadsPage");
    expect(action).toContain("searchPickerLeadsAction");
    expect(action).toContain("toPickerLead");

    expect(campaignsPage).toContain("searchPickerLeads");
    expect(campaignsPage).not.toContain("listLeads({");
    expect(campaignForm).toContain("searchPickerLeadsAction");
    expect(campaignForm).toContain("startTransition");
    expect(campaignForm).toContain("LEAD_PICKER_LIMIT_HINT");
    expect(campaignForm).toContain('type="button"');
    expect(campaignForm).not.toMatch(/if\s*\(\s*platform\s*===/);

    expect(inboxPage).toContain("searchPickerLeads");
    expect(inboxPage).toContain("leadQ");
    expect(inboxPage).toContain("LEAD_PICKER_LIMIT_HINT");
    expect(inboxPage).not.toContain("listLeads({");

    expect(leadPage).toContain("searchPickerLeads");
    expect(leadPage).toContain("mergeQ");
    expect(leadPage).toContain("LEAD_PICKER_LIMIT_HINT");
    expect(leadPage).not.toContain("listLeads({");
    expect(leadPage).toContain("do_not_contact");
  });
});
