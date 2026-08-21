import { UnsupportedActionError, ValidationError } from "@/lib/errors";
import { isTinyFishConfigured } from "@/lib/tinyfish/config";
import type {
  CollectInput,
  CollectResult,
  ConnectInput,
  ConnectResult,
  ContactActionInput,
  ContactActionResult,
  MonitorInput,
  MonitorResult,
  OAuthBeginInput,
  PublishInput,
  PublishResult,
  TokenRefreshResult,
  SocialAdapter,
  SocialCapabilities,
  SocialAccountSnapshot,
  AccountRateLimit,
} from "@/social/core/adapter";
import { collectResolvedPublicProfile } from "@/social/core/public-collect";
import { searchPublicMentions } from "@/social/core/public-monitor";
import type { PublicProfileRef } from "@/social/core/public-profile";
import type { SocialPlatform } from "@/types/social";

export type { ConnectInput, OAuthBeginInput };

export type AdapterContext = {
  accessToken?: string;
  refreshToken?: string;
  metadata?: Record<string, unknown>;
};

export const DISABLED_CAPABILITIES: SocialCapabilities = {
  publishing: false,
  scheduling: false,
  monitoring: false,
  publicCollection: false,
  contactActions: false,
  messaging: false,
};

export const DEFAULT_ACCOUNT_RATE_LIMIT: AccountRateLimit = {
  maxActions: 10,
  windowMs: 60 * 60 * 1000,
};

export abstract class BaseSocialAdapter implements SocialAdapter {
  abstract readonly platform: SocialPlatform;
  abstract readonly connectMode: "credential" | "oauth";

  abstract connect(input?: ConnectInput): Promise<ConnectResult>;
  abstract getAccount(): Promise<SocialAccountSnapshot>;
  protected abstract resolvePublicProfile(source: string): PublicProfileRef;

  getRateLimit(): AccountRateLimit {
    return DEFAULT_ACCOUNT_RATE_LIMIT;
  }

  beginOAuth(_input: OAuthBeginInput): Promise<string> {
    throw new UnsupportedActionError(`${this.platform} does not use OAuth`);
  }

  async disconnect(): Promise<void> {
    return;
  }

  async getCapabilities(): Promise<SocialCapabilities> {
    return {
      ...DISABLED_CAPABILITIES,
      publicCollection: isTinyFishConfigured(),
      monitoring: isTinyFishConfigured(),
      ...this.extraCapabilities(),
    };
  }

  protected extraCapabilities(): Partial<SocialCapabilities> {
    return {};
  }

  async collectPublicData(input: CollectInput): Promise<CollectResult> {
    if (!isTinyFishConfigured()) {
      throw new ValidationError("TINYFISH_API_KEY is not configured.");
    }

    return collectResolvedPublicProfile({
      platform: this.platform,
      profile: this.resolvePublicProfile(input.source),
    });
  }

  async publish(_input: PublishInput): Promise<PublishResult> {
    throw new UnsupportedActionError(`${this.platform} publishing is not enabled yet`);
  }

  async monitor(input: MonitorInput): Promise<MonitorResult> {
    if (!isTinyFishConfigured()) {
      throw new UnsupportedActionError(`${this.platform} monitoring is not enabled yet`);
    }

    return searchPublicMentions({
      platform: this.platform,
      keywords: input.keywords,
      sources: input.sources,
    });
  }

  async executeContactAction(_input: ContactActionInput): Promise<ContactActionResult> {
    throw new UnsupportedActionError(`${this.platform} contact actions are not enabled yet`);
  }

  async refreshTokens(): Promise<TokenRefreshResult> {
    throw new UnsupportedActionError(`${this.platform} token refresh is not enabled`);
  }
}
