import type { SocialAccountPublic } from "@/types/social-account";
import type { SocialAccountStatus } from "@/types/status";
import type { SocialPlatform } from "@/types/social";

export type SocialAccountFilter = {
  query?: string;
  platforms?: SocialPlatform[];
  statuses?: SocialAccountStatus[];
  groupAccountIds?: string[];
};

export function filterSocialAccounts(
  accounts: SocialAccountPublic[],
  filter: SocialAccountFilter,
): SocialAccountPublic[] {
  const query = filter.query?.trim().toLowerCase();

  return accounts.filter((account) => {
    if (filter.platforms && filter.platforms.length > 0 && !filter.platforms.includes(account.platform)) {
      return false;
    }

    if (filter.statuses && filter.statuses.length > 0 && !filter.statuses.includes(account.status)) {
      return false;
    }

    if (filter.groupAccountIds && !filter.groupAccountIds.includes(account.id)) {
      return false;
    }

    if (!query) {
      return true;
    }

    const haystack = [account.username, account.displayName, account.platform, account.externalAccountId]
      .filter((value): value is string => Boolean(value))
      .join(" ")
      .toLowerCase();

    return haystack.includes(query);
  });
}
