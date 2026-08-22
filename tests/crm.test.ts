import { describe, expect, it } from "vitest";
import { DoNotContactError } from "@/lib/errors";
import { isOutboundContactStatus, preferredContactStatus, profileIdentityKey, survivingDoNotContact } from "@/lib/leads/contact-status";
import { assertCanContactLead } from "@/services/leads/do-not-contact";
import {
  collectPublicProfileSchema,
  createLeadSchema,
  createNoteSchema,
  createRelationshipSchema,
  createSocialProfileSchema,
  mergeLeadsSchema,
  updateLeadSchema,
  updateRelationshipSchema,
} from "@/lib/validation/lead";
import { emptyToNull } from "@/services/leads/mapper";
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
  it("keeps BLOCKED over a later successful contact status, from either side", () => {
    expect(preferredContactStatus("MESSAGE_SENT", "BLOCKED")).toBe("BLOCKED");
    expect(preferredContactStatus("BLOCKED", "MESSAGE_SENT")).toBe("BLOCKED");
    expect(preferredContactStatus("BLOCKED", "BLOCKED")).toBe("BLOCKED");
    expect(preferredContactStatus("REPLIED", "INVITE_SENT")).toBe("REPLIED");
    expect(preferredContactStatus("FAILED", "QUEUED")).toBe("FAILED");
    expect(preferredContactStatus("QUEUED", "QUEUED")).toBe("QUEUED");
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

  it("rejects a bad email or URL on update but allows clearing them", () => {
    expect(updateLeadSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
    expect(updateLeadSchema.safeParse({ email: "" }).success).toBe(true);
    expect(updateLeadSchema.safeParse({ status: "DO_NOT_CONTACT", doNotContact: true }).success).toBe(true);
  });

  it("requires an external profile id and a known platform for a social profile", () => {
    expect(
      createSocialProfileSchema.safeParse({ platform: "vk", externalProfileId: "12345" }).success,
    ).toBe(true);
    expect(createSocialProfileSchema.safeParse({ platform: "vk", externalProfileId: "" }).success).toBe(
      false,
    );
    expect(
      createSocialProfileSchema.safeParse({ platform: "myspace", externalProfileId: "12345" }).success,
    ).toBe(false);
    expect(
      createSocialProfileSchema.safeParse({
        platform: "vk",
        externalProfileId: "12345",
        profileUrl: "not-a-url",
      }).success,
    ).toBe(false);
  });

  it("requires uuids for a relationship pair", () => {
    const validId = "11111111-1111-4111-8111-111111111111";
    expect(
      createRelationshipSchema.safeParse({ socialProfileId: validId, socialAccountId: validId }).success,
    ).toBe(true);
    expect(
      createRelationshipSchema.safeParse({ socialProfileId: "not-a-uuid", socialAccountId: validId })
        .success,
    ).toBe(false);
  });

  it("rejects an empty note body", () => {
    expect(createNoteSchema.safeParse({ body: "Called, left a voicemail" }).success).toBe(true);
    expect(createNoteSchema.safeParse({ body: "" }).success).toBe(false);
    expect(createNoteSchema.safeParse({ body: "   " }).success).toBe(false);
  });

  it("requires two distinct-looking uuids to merge", () => {
    const sourceId = "11111111-1111-4111-8111-111111111111";
    const targetId = "22222222-2222-4222-8222-222222222222";
    expect(mergeLeadsSchema.safeParse({ sourceLeadId: sourceId, targetLeadId: targetId }).success).toBe(
      true,
    );
    expect(mergeLeadsSchema.safeParse({ sourceLeadId: "not-a-uuid", targetLeadId: targetId }).success).toBe(
      false,
    );
  });

  it("requires a platform and a non-empty username or URL to collect a public profile", () => {
    expect(collectPublicProfileSchema.safeParse({ platform: "telegram", source: "durov" }).success).toBe(
      true,
    );
    expect(collectPublicProfileSchema.safeParse({ platform: "telegram", source: "" }).success).toBe(false);
  });
});

describe("emptyToNull", () => {
  it("collapses blank or whitespace-only strings to null and trims the rest", () => {
    expect(emptyToNull(undefined)).toBeNull();
    expect(emptyToNull("")).toBeNull();
    expect(emptyToNull("   ")).toBeNull();
    expect(emptyToNull("  Alex  ")).toBe("Alex");
  });
});
