import { z } from "zod";
import { AuthenticationError, SocialError, UnsupportedActionError, ValidationError } from "@/lib/errors";
import { matchKeywords, normalizeKeywords } from "@/lib/monitoring/keywords";
import { readJson, socialFetch } from "@/social/core/http";
import { BaseSocialAdapter, type AdapterContext, type ConnectInput } from "@/social/core/base-adapter";
import type {
  ConnectResult,
  ContactActionInput,
  ContactActionResult,
  InboxInput,
  InboxResult,
  MonitorInput,
  MonitorResult,
  PublishInput,
  PublishResult,
  SocialAccountSnapshot,
  SocialCapabilities,
} from "@/social/core/adapter";
import { assertMonitorSourcesAllowed } from "@/social/core/monitor-sources";
import { resolveTelegramPublicProfile } from "@/social/telegram/public-profile";
import { parseTelegramInboxUpdates } from "@/social/telegram/inbox";
import { buildTelegramMediaPayload } from "@/social/telegram/media";

const TELEGRAM_API_ORIGIN = "https://api.telegram.org";

export function telegramMethodUrl(token: string, method: string): string {
  return `${TELEGRAM_API_ORIGIN}/bot${token}/${method}`;
}

type TelegramUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
};

type TelegramGetMeResponse = {
  ok: boolean;
  description?: string;
  result?: TelegramUser;
};

const telegramGetUpdatesResponseSchema = z.object({
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
                username: z.string().optional(),
                first_name: z.string().optional(),
              })
              .optional(),
            chat: z
              .object({
                id: z.number(),
                username: z.string().optional(),
              })
              .optional(),
          })
          .optional(),
        channel_post: z
          .object({
            message_id: z.number(),
            text: z.string().optional(),
            caption: z.string().optional(),
            chat: z
              .object({
                id: z.number(),
                username: z.string().optional(),
              })
              .optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

const telegramMessageSchema = z.object({
  message_id: z.number(),
  chat: z
    .object({
      id: z.number(),
      username: z.string().optional(),
    })
    .optional(),
});

const telegramSendMessageResponseSchema = z.object({
  ok: z.boolean(),
  description: z.string().optional(),
  result: telegramMessageSchema.optional(),
});

const telegramSendMediaGroupResponseSchema = z.object({
  ok: z.boolean(),
  description: z.string().optional(),
  result: z.array(telegramMessageSchema).optional(),
});

export function telegramPublishChatId(metadata?: Record<string, unknown>): string {
  const value = metadata?.publishChatId;
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError(
      "Telegram publishing requires a destination chat. Add a channel username when connecting the bot.",
    );
  }
  return normalizeTelegramChatId(value);
}

export function telegramChatIdFromTarget(target: ContactActionInput["target"]): string {
  if (!target) {
    throw new ValidationError("Telegram contact requires a social profile target");
  }
  if (target.username) {
    return normalizeTelegramChatId(target.username);
  }
  if (/^-?\d+$/.test(target.externalProfileId)) {
    return target.externalProfileId;
  }
  return normalizeTelegramChatId(target.externalProfileId);
}

export function normalizeTelegramChatId(source: string): string {
  const trimmed = source.trim();
  if (!trimmed) {
    throw new ValidationError("Telegram chat id is required");
  }
  if (/^-?\d+$/.test(trimmed)) {
    return trimmed;
  }
  return `@${trimmed.replace(/^@/, "")}`;
}

export class TelegramAdapter extends BaseSocialAdapter {
  readonly platform = "telegram" as const;
  readonly connectMode = "credential" as const;

  constructor(private readonly context: AdapterContext = {}) {
    super();
  }

  async connect(input?: ConnectInput): Promise<ConnectResult> {
    const token = input?.credential?.trim();
    if (!token) {
      throw new ValidationError("Telegram bot token is required");
    }

    if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
      throw new ValidationError("Telegram bot token format is invalid");
    }

    const account = await this.fetchBot(token);
    return {
      ...account,
      accessToken: token,
      refreshToken: null,
      tokenExpiresAt: null,
      scopes: ["bot"],
    };
  }

  async getAccount(): Promise<SocialAccountSnapshot> {
    const token = this.context.accessToken;
    if (!token) {
      throw new AuthenticationError("Telegram account has no access token");
    }

    const account = await this.fetchBot(token);
    return {
      platform: "telegram",
      externalAccountId: account.externalAccountId,
      username: account.username,
      displayName: account.displayName,
      avatarUrl: account.avatarUrl,
      status: "CONNECTED",
    };
  }

  protected extraCapabilities(): Partial<SocialCapabilities> {
    return { monitoring: true, publishing: true, contactActions: true, messaging: true, inbox: true };
  }

  protected resolvePublicProfile(source: string) {
    return resolveTelegramPublicProfile(source);
  }

  async monitor(input: MonitorInput): Promise<MonitorResult> {
    assertMonitorSourcesAllowed("telegram", input.sources);
    const keywords = normalizeKeywords(input.keywords);
    if (keywords.length === 0) {
      throw new ValidationError("Monitoring requires at least one keyword");
    }

    const token = this.context.accessToken;
    if (!token) {
      return super.monitor(input);
    }

    const url = new URL(telegramMethodUrl(token, "getUpdates"));
    url.searchParams.set("timeout", "0");
    url.searchParams.set("allowed_updates", JSON.stringify(["message", "channel_post"]));
    if (input.cursor && /^-?\d+$/.test(input.cursor)) {
      url.searchParams.set("offset", input.cursor);
    }

    const response = await socialFetch(url.toString());
    const parsed = telegramGetUpdatesResponseSchema.safeParse(await readJson<unknown>(response));
    if (!parsed.success) {
      throw new SocialError("Telegram getUpdates returned an unexpected payload");
    }
    if (!parsed.data.ok) {
      throw new SocialError(parsed.data.description ?? "Telegram getUpdates failed");
    }

    const updates = parsed.data.result ?? [];
    const events = [];
    let maxUpdateId = input.cursor && /^-?\d+$/.test(input.cursor) ? Number(input.cursor) - 1 : 0;

    for (const update of updates) {
      maxUpdateId = Math.max(maxUpdateId, update.update_id);
      const payload = update.message ?? update.channel_post;
      const text = payload?.text ?? payload?.caption;
      if (!payload || !text) {
        continue;
      }

      const matchedKeywords = matchKeywords(text, keywords);
      if (matchedKeywords.length === 0) {
        continue;
      }

      const username = payload.chat?.username;
      const sender = update.message?.from;
      const from = sender
        ? (sender.username ? `@${sender.username}` : (sender.first_name ?? null))
        : username
          ? `@${username}`
          : null;

      events.push({
        externalId: String(update.update_id),
        author: from,
        content: text,
        url: username ? `https://t.me/${username}/${payload.message_id}` : null,
        matchedKeywords,
      });
    }

    return {
      events,
      cursor: updates.length > 0 ? String(maxUpdateId + 1) : (input.cursor ?? null),
    };
  }

  async collectInbox(input: InboxInput): Promise<InboxResult> {
    const token = this.context.accessToken;
    if (!token) {
      throw new AuthenticationError("Telegram account has no access token");
    }

    const url = new URL(telegramMethodUrl(token, "getUpdates"));
    url.searchParams.set("timeout", "0");
    url.searchParams.set("allowed_updates", JSON.stringify(["message"]));
    if (input.cursor && /^-?\d+$/.test(input.cursor)) {
      url.searchParams.set("offset", input.cursor);
    }

    const response = await socialFetch(url.toString());
    return parseTelegramInboxUpdates(await readJson<unknown>(response), input.cursor);
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const token = this.context.accessToken;
    if (!token) {
      throw new AuthenticationError("Telegram account has no access token");
    }
    const chatId = telegramPublishChatId(this.context.metadata);
    const sent =
      input.media.length === 0
        ? await this.sendMessage(token, chatId, input.body)
        : await this.sendMedia(token, chatId, input.body, input.media);
    return {
      externalPostId: sent.externalId,
      publishedAt: new Date().toISOString(),
    };
  }

  async executeContactAction(input: ContactActionInput): Promise<ContactActionResult> {
    if (input.action !== "MESSAGE") {
      throw new UnsupportedActionError("Telegram bots can send messages but cannot invite contacts");
    }

    const token = this.context.accessToken;
    if (!token) {
      throw new AuthenticationError("Telegram account has no access token");
    }

    const text = input.body?.trim();
    if (!text) {
      throw new ValidationError("Telegram messages require a body");
    }

    const chatId = telegramChatIdFromTarget(input.target);
    const sent = await this.sendMessage(token, chatId, text);
    return {
      status: "SUCCESS",
      externalMessageId: sent.externalId,
    };
  }

  private async sendMessage(token: string, chatId: string, text: string) {
    const body = text.trim();
    if (!body) {
      throw new ValidationError("Telegram messages require text");
    }

    const response = await socialFetch(telegramMethodUrl(token, "sendMessage"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: body }),
    });
    const parsed = telegramSendMessageResponseSchema.safeParse(await readJson<unknown>(response));
    if (!parsed.success || !parsed.data.ok || !parsed.data.result) {
      throw new SocialError(
        (parsed.success ? parsed.data.description : undefined) ?? "Telegram sendMessage returned an unexpected payload",
      );
    }

    const message = parsed.data.result;
    return this.toSentMessage(chatId, message);
  }

  private async sendMedia(token: string, chatId: string, text: string, media: string[]) {
    const payload = buildTelegramMediaPayload({ chatId, body: text, media });
    const response = await socialFetch(telegramMethodUrl(token, payload.method), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload.body),
    });
    const json = await readJson<unknown>(response);
    if (payload.method === "sendMediaGroup") {
      const parsed = telegramSendMediaGroupResponseSchema.safeParse(json);
      const first = parsed.success ? parsed.data.result?.[0] : undefined;
      if (!parsed.success || !parsed.data.ok || !first) {
        throw new SocialError(
          (parsed.success ? parsed.data.description : undefined) ?? "Telegram sendMediaGroup returned an unexpected payload",
        );
      }
      return this.toSentMessage(chatId, first);
    }

    const parsed = telegramSendMessageResponseSchema.safeParse(json);
    if (!parsed.success || !parsed.data.ok || !parsed.data.result) {
      throw new SocialError(
        (parsed.success ? parsed.data.description : undefined) ?? `Telegram ${payload.method} returned an unexpected payload`,
      );
    }
    return this.toSentMessage(chatId, parsed.data.result);
  }

  private toSentMessage(
    chatId: string,
    message: { message_id: number; chat?: { id: number; username?: string } },
  ) {
    const username = message.chat?.username;
    return {
      externalId: `${message.chat?.id ?? chatId}:${message.message_id}`,
      url: username ? `https://t.me/${username}/${message.message_id}` : null,
    };
  }

  private async fetchBot(token: string) {
    const response = await socialFetch(telegramMethodUrl(token, "getMe"));
    const payload = await readJson<TelegramGetMeResponse>(response);

    if (!payload.ok || !payload.result) {
      throw new AuthenticationError(payload.description ?? "Telegram getMe failed");
    }

    const bot = payload.result;
    const username = bot.username ? `@${bot.username}` : null;

    return {
      externalAccountId: String(bot.id),
      username,
      displayName: bot.first_name ?? username,
      avatarUrl: null,
    };
  }
}
