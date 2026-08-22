import { describe, expect, it } from "vitest";
import {
  AppError,
  AuthenticationError,
  BotBlockedError,
  DoNotContactError,
  NetworkError,
  PermissionError,
  PolicyError,
  RateLimitError,
  SocialAccountUnavailableError,
  SocialError,
  UnsupportedActionError,
  ValidationError,
  errorMessage,
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

  it("assigns the documented code and status to every remaining error class", () => {
    expect(new AuthenticationError().code).toBe("UNAUTHENTICATED");
    expect(new AuthenticationError().status).toBe(401);
    expect(new SocialError("upstream failed").code).toBe("SOCIAL_ERROR");
    expect(new SocialError("upstream failed").status).toBe(502);
    expect(new UnsupportedActionError().code).toBe("UNSUPPORTED_ACTION");
    expect(new UnsupportedActionError().status).toBe(422);
    expect(new NetworkError().code).toBe("NETWORK_ERROR");
    expect(new NetworkError().status).toBe(503);
    expect(new ValidationError("bad input").code).toBe("VALIDATION_ERROR");
    expect(new ValidationError("bad input").status).toBe(400);
  });

  it("does not treat a plain Error as an AppError", () => {
    expect(isAppError(new Error("boom"))).toBe(false);
    expect(isAppError("boom")).toBe(false);
    expect(isAppError(null)).toBe(false);
  });

  it("defaults AppError status to 400 and carries details and cause through", () => {
    const cause = new Error("root cause");
    const error = new AppError("custom failure", { code: "CUSTOM", details: { field: "x" }, cause });
    expect(error.status).toBe(400);
    expect(error.details).toEqual({ field: "x" });
    expect(error.cause).toBe(cause);
    expect(error.name).toBe("AppError");
  });
});

describe("errorMessage", () => {
  it("prefers an AppError's own message over the fallback", () => {
    expect(errorMessage(new ValidationError("Post body is required"), "fallback")).toBe(
      "Post body is required",
    );
  });

  it("uses a plain Error's message when present", () => {
    expect(errorMessage(new Error("network down"), "fallback")).toBe("network down");
  });

  it("falls back when a plain Error has an empty message", () => {
    expect(errorMessage(new Error(""), "fallback")).toBe("fallback");
  });

  it("reads a message off a plain object that is not an Error instance", () => {
    expect(errorMessage({ message: "supabase says no" }, "fallback")).toBe("supabase says no");
  });

  it("falls back for values with no usable message", () => {
    expect(errorMessage(null, "fallback")).toBe("fallback");
    expect(errorMessage(undefined, "fallback")).toBe("fallback");
    expect(errorMessage("just a string", "fallback")).toBe("fallback");
    expect(errorMessage({ message: "" }, "fallback")).toBe("fallback");
    expect(errorMessage({}, "fallback")).toBe("fallback");
  });

  it("defaults the fallback to 'Unexpected error'", () => {
    expect(errorMessage(null)).toBe("Unexpected error");
  });
});

describe("do not contact guard", () => {
  it("blocks outbound contact when the lead flag is set", () => {
    expect(canContactLead({ do_not_contact: false })).toBe(true);
    expect(canContactLead({ do_not_contact: true })).toBe(false);
    expect(() => assertCanContactLead({ do_not_contact: true })).toThrow(DoNotContactError);
  });
});
