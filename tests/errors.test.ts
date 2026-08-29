import { describe, expect, it } from "vitest";
import {
  BotBlockedError,
  DoNotContactError,
  PermissionError,
  PolicyError,
  RateLimitError,
  SocialAccountUnavailableError,
  isAppError,
} from "@/lib/errors";
import { assertCanContactLead, canContactLead } from "@/services/leads/do-not-contact";

describe("error model", () => {
  it("keeps domain errors distinguishable", () => {
    expect(new DoNotContactError().code).toBe("DO_NOT_CONTACT");
    expect(new PermissionError().status).toBe(403);
    expect(new RateLimitError().status).toBe(429);
    expect(new SocialAccountUnavailableError().code).toBe("SOCIAL_ACCOUNT_UNAVAILABLE");
    expect(new PolicyError().code).toBe("POLICY_DENIED");
    expect(new BotBlockedError().code).toBe("BOT_BLOCKED");
    expect(isAppError(new DoNotContactError())).toBe(true);
  });
});

describe("do not contact guard", () => {
  it("blocks outbound contact when the lead flag is set", () => {
    expect(canContactLead({ do_not_contact: false })).toBe(true);
    expect(canContactLead({ do_not_contact: true })).toBe(false);
    expect(() => assertCanContactLead({ do_not_contact: true })).toThrow(DoNotContactError);
  });
});
