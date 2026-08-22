import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RateLimitError } from "@/lib/errors";
import { AccountRateLimiter, windowStart } from "@/lib/jobs/account-rate-limiter";
import {
  buildEnqueuePairs,
  canStartCampaign,
  isAdapterContactAction,
  jobStatusAfterError,
} from "@/lib/jobs/queue-rules";
import { getSocialAdapter } from "@/social/core/registry";
import { DEFAULT_ACCOUNT_RATE_LIMIT } from "@/social/core/base-adapter";
import { createCampaignSchema } from "@/lib/validation/campaign";

describe("campaign queue rules", () => {
  it("starts only from DRAFT or PAUSED", () => {
    expect(canStartCampaign("DRAFT")).toBe(true);
    expect(canStartCampaign("PAUSED")).toBe(true);
    expect(canStartCampaign("RUNNING")).toBe(false);
    expect(canStartCampaign("COMPLETED")).toBe(false);
  });

  it("enqueues one job per lead/account pair on the same platform and skips DNC leads", () => {
    const pairs = buildEnqueuePairs({
      leadIds: ["lead-dnc", "lead-ok"],
      skippedLeadIds: new Set(["lead-dnc"]),
      accounts: [
        { id: "acc-tg", platform: "telegram" },
        { id: "acc-vk", platform: "vk" },
      ],
      profiles: [
        { id: "p1", leadId: "lead-ok", platform: "telegram" },
        { id: "p2", leadId: "lead-dnc", platform: "telegram" },
      ],
    });

    expect(pairs).toEqual([
      { leadId: "lead-ok", socialAccountId: "acc-tg", socialProfileId: "p1" },
    ]);
  });

  it("retries retryable errors until max attempts", () => {
    expect(jobStatusAfterError({ attempts: 1, maxAttempts: 5, retryable: true }).status).toBe("RETRY");
    expect(jobStatusAfterError({ attempts: 5, maxAttempts: 5, retryable: true }).status).toBe("FAILED");
    expect(jobStatusAfterError({ attempts: 1, maxAttempts: 5, retryable: false }).status).toBe("FAILED");
  });

  it("sends only invite/message through adapters", () => {
    expect(isAdapterContactAction("MESSAGE")).toBe(true);
    expect(isAdapterContactAction("MANUAL_ACTION_REQUIRED")).toBe(false);
  });
});

describe("campaign validation", () => {
  it("requires a name, an action, at least one lead, and at least one account", () => {
    const validId = "11111111-1111-4111-8111-111111111111";
    expect(
      createCampaignSchema.safeParse({
        name: "Q3 outreach",
        action: "MESSAGE",
        leadIds: [validId],
        accountIds: [validId],
      }).success,
    ).toBe(true);
    expect(
      createCampaignSchema.safeParse({
        name: "Q",
        action: "MESSAGE",
        leadIds: [validId],
        accountIds: [validId],
      }).success,
    ).toBe(false);
    expect(
      createCampaignSchema.safeParse({
        name: "Q3 outreach",
        action: "MESSAGE",
        leadIds: [],
        accountIds: [validId],
      }).success,
    ).toBe(false);
    expect(
      createCampaignSchema.safeParse({
        name: "Q3 outreach",
        action: "MESSAGE",
        leadIds: [validId],
        accountIds: [],
      }).success,
    ).toBe(false);
    expect(
      createCampaignSchema.safeParse({
        name: "Q3 outreach",
        action: "SEND_GIFT",
        leadIds: [validId],
        accountIds: [validId],
      }).success,
    ).toBe(false);
  });
});

describe("AccountRateLimiter", () => {
  it("throws when the consumed count exceeds the adapter limit", async () => {
    const limiter = new AccountRateLimiter(async () => 11);
    await expect(limiter.take("acc-1", { maxActions: 10, windowMs: 60_000 })).rejects.toBeInstanceOf(
      RateLimitError,
    );
  });

  it("allows a count inside the window", async () => {
    const limiter = new AccountRateLimiter(async () => 3);
    await expect(limiter.take("acc-1", { maxActions: 10, windowMs: 60_000 })).resolves.toBeUndefined();
  });

  it("aligns windows to the limit duration", () => {
    const now = new Date("2026-08-21T13:37:00.000Z");
    expect(windowStart(now, 60 * 60 * 1000).toISOString()).toBe("2026-08-21T13:00:00.000Z");
  });
});

describe("adapter rate limits", () => {
  it("exposes rate limits from adapters instead of worker platform switches", () => {
    expect(getSocialAdapter("telegram").getRateLimit()).toEqual(DEFAULT_ACCOUNT_RATE_LIMIT);
    const worker = readFileSync("services/jobs/worker-service.ts", "utf8");
    const limiter = readFileSync("services/social-accounts/rate-limit-service.ts", "utf8");
    expect(worker).not.toMatch(/platform\s*===\s*["']telegram["']/);
    expect(worker).toContain("takeAccountAdapterRate");
    expect(limiter).toContain("adapter.getRateLimit()");
  });
});
