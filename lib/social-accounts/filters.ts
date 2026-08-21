import { SOCIAL_ACCOUNT_STATUSES, type SocialAccountStatus } from "@/types/status";
import { SOCIAL_PLATFORMS, type SocialPlatform } from "@/types/social";

export function parseSocialAccountStatusFilter(value: string | undefined): SocialAccountStatus | undefined {
  if (value && (SOCIAL_ACCOUNT_STATUSES as readonly string[]).includes(value)) {
    return value as SocialAccountStatus;
  }
  return undefined;
}

export function parseSocialAccountPlatformFilter(value: string | undefined): SocialPlatform | undefined {
  if (value && (SOCIAL_PLATFORMS as readonly string[]).includes(value)) {
    return value as SocialPlatform;
  }
  return undefined;
}
