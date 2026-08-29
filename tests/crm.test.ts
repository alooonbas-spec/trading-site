import { describe, expect, it } from "vitest";
import { DoNotContactError } from "@/lib/errors";
import { isOutboundContactStatus, preferredContactStatus, profileIdentityKey, survivingDoNotContact } from "@/lib/leads/contact-status";
import { assertCanContactLead } from "@/services/leads/do-not-contact";
import { createLeadSchema, updateRelationshipSchema } from "@/lib/validation/lead";
import { CONTACT_STATUSES, LEAD_STATUSES } from "@/types/status";

describe("lead and contact machines stay independent", () => {
  it("does not reuse lead statuses as contact statuses", () => {
    for (const status of LEAD_STATUSES) {
      expect(CONTACT_STATUSES).not.toContain(status);
    }
  });

  it("treats do_not_contact as a lead flag, not a contact status", () => {
    expect(CONTACT_STATUSES).not.toContain("DO_NOT_CONTACT");
    expect(LEAD_STATUSES).toContain("DO_NOT_CONTACT");
  });
});

describe("outbound contact guard", () => {
  it("blocks queued and message statuses when the lead flag is set", () => {
    expect(isOutboundContactStatus("QUEUED")).toBe(true);
    expect(isOutboundContactStatus("MESSAGE_SENT")).toBe(true);
    expect(isOutboundContactStatus("REPLIED")).toBe(false);
    expect(isOutboundContactStatus("BLOCKED")).toBe(false);
    expect(() => assertCanContactLead({ do_not_contact: true })).toThrow(DoNotContactError);
    expect(() => assertCanContactLead({ do_not_contact: false })).not.toThrow();
  });
});

describe("merge helpers", () => {
  it("keeps BLOCKED over a later successful contact status", () => {
    expect(preferredContactStatus("MESSAGE_SENT", "BLOCKED")).toBe("BLOCKED");
    expect(preferredContactStatus("REPLIED", "INVITE_SENT")).toBe("REPLIED");
    expect(preferredContactStatus("FAILED", "QUEUED")).toBe("FAILED");
  });

  it("identifies duplicate social profiles by platform and external id", () => {
    expect(profileIdentityKey("telegram", "42")).toBe("telegram:42");
  });

  it("ORs do_not_contact onto the surviving lead", () => {
    expect(survivingDoNotContact(false, true)).toBe(true);
    expect(survivingDoNotContact(true, false)).toBe(true);
    expect(survivingDoNotContact(false, false)).toBe(false);
  });
});

describe("lead validation", () => {
  it("requires a display name and accepts optional email", () => {
    expect(createLeadSchema.safeParse({ displayName: "" }).success).toBe(false);
    expect(createLeadSchema.safeParse({ displayName: "Alex", email: "alex@example.com" }).success).toBe(true);
    expect(updateRelationshipSchema.safeParse({ status: "NEW" }).success).toBe(false);
    expect(updateRelationshipSchema.safeParse({ status: "NOT_CONTACTED" }).success).toBe(true);
  });
});
