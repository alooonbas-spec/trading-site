import { z } from "zod";
import { SocialError } from "@/lib/errors";
import type { InboxMessage, InboxResult } from "@/social/core/adapter";

const telegramInboxUpdateSchema = z.object({
  ok: z.boolean(),
  description: z.string().optional(),
  result: z
    .array(
      z.object({
        update_id: z.number(),
        message: z
          .object({
            message_id: z.number(),
            text: z.string().optional(),
            caption: z.string().optional(),
            from: z
              .object({
                id: z.number(),
                is_bot: z.boolean().optional(),
                username: z.string().optional(),
                first_name: z.string().optional(),
              })
              .optional(),
            chat: z
              .object({
                id: z.number(),
                username: z.string().optional(),
                type: z.string().optional(),
              })
              .optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

export function parseTelegramInboxUpdates(payload: unknown, cursor?: string | null): InboxResult {
  const parsed = telegramInboxUpdateSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("Telegram getUpdates returned an unexpected payload");
  }
  if (!parsed.data.ok) {
    throw new SocialError(parsed.data.description ?? "Telegram getUpdates failed");
  }

  const updates = parsed.data.result ?? [];
  const messages: InboxMessage[] = [];
  let maxUpdateId = cursor && /^-?\d+$/.test(cursor) ? Number(cursor) - 1 : 0;

  for (const update of updates) {
    maxUpdateId = Math.max(maxUpdateId, update.update_id);
    const message = update.message;
    const text = message?.text ?? message?.caption;
    const from = message?.from;
    if (!message || !text || !from || from.is_bot) {
      continue;
    }

    const username = from.username ? `@${from.username}` : null;
    messages.push({
      externalId: String(update.update_id),
      externalProfileId: String(from.id),
      username,
      body: text,
      url: message.chat?.username ? `https://t.me/${message.chat.username}/${message.message_id}` : null,
      receivedAt: new Date().toISOString(),
    });
  }

  return {
    messages,
    cursor: updates.length > 0 ? String(maxUpdateId + 1) : (cursor ?? null),
  };
}
