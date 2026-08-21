import { AuthenticationError, ValidationError } from "@/lib/errors";
import { readJson, socialFetch } from "@/social/core/http";
import { BaseSocialAdapter, DISABLED_CAPABILITIES, type AdapterContext, type ConnectInput } from "@/social/core/base-adapter";
import type { ConnectResult, SocialAccountSnapshot, SocialCapabilities } from "@/social/core/adapter";

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

  async getCapabilities(): Promise<SocialCapabilities> {
    return DISABLED_CAPABILITIES;
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
