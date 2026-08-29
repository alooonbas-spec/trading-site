import { createClient } from "@/lib/supabase/server";
import { ValidationError } from "@/lib/errors";
import { AccountRateLimiter } from "@/lib/jobs/account-rate-limiter";
import type { SocialAdapter } from "@/social/core/adapter";

export async function takeAccountAdapterRate(accountId: string, adapter: SocialAdapter): Promise<void> {
  const supabase = await createClient();
  const limiter = new AccountRateLimiter(async ({ accountId: rateAccountId, windowStart, maxActions }) => {
    const { data, error: rateError } = await supabase.rpc("increment_account_rate_bucket", {
      p_account_id: rateAccountId,
      p_window_start: windowStart,
      p_max: maxActions,
    });
    if (rateError) {
      throw new ValidationError(rateError.message);
    }
    return data ?? 0;
  });
  await limiter.take(accountId, adapter.getRateLimit());
}
