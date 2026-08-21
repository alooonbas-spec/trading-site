import type { InboxMessage } from "@/social/core/adapter";
import type { SocialPlatform } from "@/types/social";

export type InboxIdentityFields = {
  externalProfileId: string;
  username: string | null;
};

export type InboxProfileLinkResolution =
  | { kind: "create" }
  | { kind: "reuse"; leadId: string }
  | { kind: "conflict"; leadId: string };

export function normalizeInboxIdentity(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().replace(/^@/, "").toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export function inboxUsernameForProfile(username: string | null | undefined): string | undefined {
  const normalized = username?.trim().replace(/^@/, "");
  return normalized && normalized.length > 0 ? normalized : undefined;
}

export function inboxEventToMessage(event: InboxIdentityFields & {
  externalId: string;
  body: string;
  url: string | null;
  receivedAt: string | null;
}): InboxMessage {
  return {
    externalId: event.externalId,
    externalProfileId: event.externalProfileId,
    username: event.username,
    body: event.body,
    url: event.url,
    receivedAt: event.receivedAt,
  };
}

export function inboxMessageMatchesProfile(
  message: InboxIdentityFields,
  profile: InboxIdentityFields,
): boolean {
  const known = new Set(
    [normalizeInboxIdentity(profile.externalProfileId), normalizeInboxIdentity(profile.username)].filter(
      (item): item is string => item !== null,
    ),
  );
  if (known.size === 0) {
    return false;
  }

  const incoming = [normalizeInboxIdentity(message.externalProfileId), normalizeInboxIdentity(message.username)];
  return incoming.some((item) => item !== null && known.has(item));
}

export function resolveInboxProfileLink(
  profiles: Array<InboxIdentityFields & { leadId: string }>,
  message: InboxIdentityFields,
  targetLeadId: string,
): InboxProfileLinkResolution {
  const match = profiles.find((profile) => inboxMessageMatchesProfile(message, profile));
  if (!match) {
    return { kind: "create" };
  }
  if (match.leadId === targetLeadId) {
    return { kind: "reuse", leadId: match.leadId };
  }
  return { kind: "conflict", leadId: match.leadId };
}

export function unmatchedInboxEventsForProfile<T extends InboxIdentityFields & {
  matched: boolean;
  platform: SocialPlatform;
}>(
  events: T[],
  platform: SocialPlatform,
  profile: InboxIdentityFields,
): T[] {
  return events.filter(
    (event) =>
      !event.matched &&
      event.platform === platform &&
      inboxMessageMatchesProfile(event, profile),
  );
}

export function inboxCursorFromMetadata(metadata?: Record<string, unknown>): string | null {
  const value = metadata?.inboxCursor;
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  return value.trim();
}
