import { ValidationError } from "@/lib/errors";
import { INBOX_REPLY_KINDS, type InboxReplyKind } from "@/social/core/adapter";
import type { SocialPlatform } from "@/types/social";

export const INBOX_REPLY_KIND_LABELS: Record<InboxReplyKind, string> = {
  direct_message: "Direct message",
  comment: "Comment",
  mention: "Mention",
};

export function isInboxReplyKind(value: string | null | undefined): value is InboxReplyKind {
  return typeof value === "string" && (INBOX_REPLY_KINDS as readonly string[]).includes(value);
}

export function inferInboxReplyKind(platform: SocialPlatform, url: string | null): InboxReplyKind {
  if (platform === "telegram") {
    return "direct_message";
  }
  if (platform === "vk") {
    return "comment";
  }
  if (platform === "x") {
    return isPublicStatusUrl(url, ["x.com", "twitter.com"]) ? "mention" : "direct_message";
  }
  if (platform === "facebook") {
    return isPublicStatusUrl(url, ["facebook.com", "fb.com"]) ? "comment" : "direct_message";
  }
  if (platform === "instagram") {
    return isPublicStatusUrl(url, ["instagram.com"]) ? "comment" : "direct_message";
  }

  throw new ValidationError("Unable to infer inbox reply kind for this event");
}

export function resolveInboxReplyKind(input: {
  stored: string | null | undefined;
  platform: SocialPlatform;
  url: string | null;
}): InboxReplyKind {
  if (isInboxReplyKind(input.stored)) {
    return input.stored;
  }
  return inferInboxReplyKind(input.platform, input.url);
}

function isPublicStatusUrl(url: string | null, hosts: string[]): boolean {
  if (!url) {
    return false;
  }
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, "").toLowerCase();
    return hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}
