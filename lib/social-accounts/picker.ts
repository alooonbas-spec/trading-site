import type { SocialPlatform } from "@/types/social";
import type { SocialAccountPublic } from "@/types/social-account";
import type { SocialAccountStatus } from "@/types/status";

export const ACCOUNT_PICKER_LIMIT_HINT =
  "Shows the newest 200 matching accounts. Search to find others. This picker does not load every workspace account.";

export const ACCOUNT_PICKER_QUERY_MAX = 120;

export type PickerAccount = {
  id: string;
  platform: SocialPlatform;
  username: string | null;
  displayName: string | null;
  externalAccountId: string;
  avatarUrl: string | null;
  status: SocialAccountStatus;
};

export function toPickerAccount(account: SocialAccountPublic): PickerAccount {
  return {
    id: account.id,
    platform: account.platform,
    username: account.username,
    displayName: account.displayName,
    externalAccountId: account.externalAccountId,
    avatarUrl: account.avatarUrl,
    status: account.status,
  };
}

export function sanitizeAccountPickerQuery(value: string | undefined): string | undefined {
  const query = (value ?? "").trim().slice(0, ACCOUNT_PICKER_QUERY_MAX);
  return query.length > 0 ? query : undefined;
}

export function withSelectedPickerAccount(
  accounts: PickerAccount[],
  selected: PickerAccount | undefined,
): PickerAccount[] {
  if (!selected) {
    return accounts;
  }
  if (accounts.some((account) => account.id === selected.id)) {
    return accounts;
  }
  return [selected, ...accounts];
}
