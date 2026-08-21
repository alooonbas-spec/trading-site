import { z } from "zod";
import { INBOX_REPLY_KINDS, type InboxReplyKind } from "@/social/core/adapter";
import { SOCIAL_PLATFORMS, type SocialPlatform } from "@/types/social";
import { INBOX_MATCH_FILTERS, type InboxMatchFilter } from "@/types/inbox";

export const INBOX_REPLY_KIND_FILTERS = ["all", ...INBOX_REPLY_KINDS] as const;

export type InboxReplyKindFilter = (typeof INBOX_REPLY_KIND_FILTERS)[number];

const accountIdSchema = z.uuid();

export function parseInboxMatchFilter(value: string | undefined): InboxMatchFilter {
  if (value && (INBOX_MATCH_FILTERS as readonly string[]).includes(value)) {
    return value as InboxMatchFilter;
  }
  return "all";
}

export function parseInboxReplyKindFilter(value: string | undefined): InboxReplyKind | undefined {
  if (value && (INBOX_REPLY_KINDS as readonly string[]).includes(value)) {
    return value as InboxReplyKind;
  }
  return undefined;
}

export function parseInboxPlatformFilter(value: string | undefined): SocialPlatform | undefined {
  if (value && (SOCIAL_PLATFORMS as readonly string[]).includes(value)) {
    return value as SocialPlatform;
  }
  return undefined;
}

export function parseInboxAccountIdFilter(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = accountIdSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
