import type { InboxResult } from "@/social/core/adapter";
import { parseTelegramUpdates } from "@/social/telegram/updates";

export function parseTelegramInboxUpdates(payload: unknown, cursor?: string | null): InboxResult {
  const parsed = parseTelegramUpdates(payload, cursor);
  return {
    messages: parsed.inboxMessages,
    cursor: parsed.cursor,
  };
}
