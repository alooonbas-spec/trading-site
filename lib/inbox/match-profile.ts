import type { InboxMessage } from "@/social/core/adapter";

export function normalizeInboxIdentity(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().replace(/^@/, "").toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export function inboxMessageMatchesProfile(
  message: InboxMessage,
  profile: { externalProfileId: string; username: string | null },
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

export function inboxCursorFromMetadata(metadata?: Record<string, unknown>): string | null {
  const value = metadata?.inboxCursor;
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  return value.trim();
}
