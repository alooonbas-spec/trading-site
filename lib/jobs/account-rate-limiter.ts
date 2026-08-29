import { RateLimitError } from "@/lib/errors";
import type { AccountRateLimit } from "@/social/core/adapter";

export function windowStart(now: Date, windowMs: number): Date {
  const ts = now.getTime();
  return new Date(ts - (ts % windowMs));
}

export class AccountRateLimiter {
  constructor(
    private readonly consume: (input: {
      accountId: string;
      windowStart: string;
      maxActions: number;
    }) => Promise<number>,
  ) {}

  async take(accountId: string, limit: AccountRateLimit, now = new Date()): Promise<void> {
    if (limit.maxActions < 1) {
      throw new RateLimitError("Account rate limit is disabled");
    }

    const start = windowStart(now, limit.windowMs).toISOString();
    const count = await this.consume({
      accountId,
      windowStart: start,
      maxActions: limit.maxActions,
    });

    if (count > limit.maxActions) {
      throw new RateLimitError("Social account rate limit reached", {
        accountId,
        count,
        maxActions: limit.maxActions,
        windowStart: start,
      });
    }
  }
}
