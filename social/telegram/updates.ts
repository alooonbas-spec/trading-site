import { z } from "zod";
import { SocialError } from "@/lib/errors";
import { readJson, socialFetch } from "@/social/core/http";
import type { InboxMessage } from "@/social/core/adapter";

const TELEGRAM_API_ORIGIN = "https://api.telegram.org";

export const TELEGRAM_SHARED_UPDATE_TYPES = ["message", "channel_post"] as const;

export function telegramMethodUrl(token: string, method: string): string {
  return `${TELEGRAM_API_ORIGIN}/bot${token}/${method}`;
}

const telegramFromSchema = z
  .object({
    id: z.number().optional(),
    is_bot: z.boolean().optional(),
    username: z.string().optional(),
    first_name: z.string().optional(),
  })
  .optional();

const telegramChatSchema = z
  .object({
    id: z.number(),
    username: z.string().optional(),
    type: z.string().optional(),
  })
  .optional();

const telegramPayloadSchema = z
  .object({
    message_id: z.number(),
    text: z.string().optional(),
    caption: z.string().optional(),
    from: telegramFromSchema,
    chat: telegramChatSchema,
  })
  .optional();

const telegramGetUpdatesResponseSchema = z.object({
  ok: z.boolean(),
  description: z.string().optional(),
  result: z
    .array(
      z.object({
        update_id: z.number(),
        message: telegramPayloadSchema,
        channel_post: telegramPayloadSchema,
      }),
    )
    .optional(),
});

export type TelegramMonitorCandidate = {
  externalId: string;
  author: string | null;
  content: string;
  url: string | null;
};

export type TelegramUpdateBatch = {
  inboxMessages: InboxMessage[];
  monitorCandidates: TelegramMonitorCandidate[];
  cursor: string | null;
};

export function isTelegramPrivateInboxChat(chatType: string | undefined): boolean {
  return chatType === undefined || chatType === "private";
}

export function parseTelegramUpdates(payload: unknown, cursor?: string | null): TelegramUpdateBatch {
  const parsed = telegramGetUpdatesResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("Telegram getUpdates returned an unexpected payload");
  }
  if (!parsed.data.ok) {
    throw new SocialError(parsed.data.description ?? "Telegram getUpdates failed");
  }

  const updates = parsed.data.result ?? [];
  const inboxMessages: InboxMessage[] = [];
  const monitorCandidates: TelegramMonitorCandidate[] = [];
  let maxUpdateId = cursor && /^-?\d+$/.test(cursor) ? Number(cursor) - 1 : 0;

  for (const update of updates) {
    maxUpdateId = Math.max(maxUpdateId, update.update_id);
    const message = update.message;
    const channelPost = update.channel_post;
    const monitorPayload = message ?? channelPost;
    const monitorText = monitorPayload?.text ?? monitorPayload?.caption;
    if (monitorPayload && monitorText) {
      const username = monitorPayload.chat?.username;
      const sender = message?.from;
      const author = sender
        ? sender.username
          ? `@${sender.username}`
          : (sender.first_name ?? null)
        : username
          ? `@${username}`
          : null;
      monitorCandidates.push({
        externalId: String(update.update_id),
        author,
        content: monitorText,
        url: username ? `https://t.me/${username}/${monitorPayload.message_id}` : null,
      });
    }

    const inboxText = message?.text ?? message?.caption;
    const from = message?.from;
    if (
      !message ||
      !inboxText ||
      !from ||
      from.is_bot ||
      from.id === undefined ||
      !isTelegramPrivateInboxChat(message.chat?.type)
    ) {
      continue;
    }

    const username = from.username ? `@${from.username}` : null;
    inboxMessages.push({
      externalId: String(update.update_id),
      externalProfileId: String(from.id),
      username,
      body: inboxText,
      url: message.chat?.username ? `https://t.me/${message.chat.username}/${message.message_id}` : null,
      receivedAt: new Date().toISOString(),
      replyKind: "direct_message",
    });
  }

  return {
    inboxMessages,
    monitorCandidates,
    cursor: updates.length > 0 ? String(maxUpdateId + 1) : (cursor ?? null),
  };
}

export async function fetchTelegramUpdates(token: string, cursor?: string | null): Promise<TelegramUpdateBatch> {
  const url = new URL(telegramMethodUrl(token, "getUpdates"));
  url.searchParams.set("timeout", "0");
  url.searchParams.set("allowed_updates", JSON.stringify([...TELEGRAM_SHARED_UPDATE_TYPES]));
  if (cursor && /^-?\d+$/.test(cursor)) {
    url.searchParams.set("offset", cursor);
  }

  const response = await socialFetch(url.toString());
  return parseTelegramUpdates(await readJson<unknown>(response), cursor);
}
