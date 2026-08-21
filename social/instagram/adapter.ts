import { AuthenticationError, ValidationError } from "@/lib/errors";
import { readJson, socialFetch } from "@/social/core/http";
import {
  BaseSocialAdapter,
  type AdapterContext,
  type ConnectInput,
  type OAuthBeginInput,
} from "@/social/core/base-adapter";
import type {
  ConnectResult,
  PublishInput,
  PublishResult,
  SocialAccountSnapshot,
  SocialCapabilities,
  TokenRefreshResult,
} from "@/social/core/adapter";
import { INSTAGRAM_SCOPES, executeInstagramPublish, planInstagramPublish, resolveInstagramUserId } from "@/social/instagram/publish";
import { resolveInstagramPublicProfile } from "@/social/instagram/public-profile";

const INSTAGRAM_AUTHORIZE_URL = "https://www.instagram.com/oauth/authorize";
const INSTAGRAM_TOKEN_URL = "https://api.instagram.com/oauth/access_token";
const INSTAGRAM_LONG_LIVED_URL = "https://graph.instagram.com/access_token";
const INSTAGRAM_REFRESH_URL = "https://graph.instagram.com/refresh_access_token";
const INSTAGRAM_ME_URL = "https://graph.instagram.com/me";

export { INSTAGRAM_SCOPES } from "@/social/instagram/publish";

type InstagramShortLivedResponse = {
  access_token?: string;
  user_id?: number | string;
  permissions?: string[];
  error_message?: string;
};

type InstagramLongLivedResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
};

type InstagramMeResponse = {
  id?: string;
  user_id?: string;
  username?: string;
  name?: string;
  profile_picture_url?: string;
};

function instagramAppId(): string {
  const appId = process.env.INSTAGRAM_APP_ID;
  if (!appId) {
    throw new ValidationError("Instagram OAuth is not configured. Set INSTAGRAM_APP_ID.");
  }
  return appId;
}

function instagramAppSecret(): string {
  const secret = process.env.INSTAGRAM_APP_SECRET;
  if (!secret) {
    throw new ValidationError("Instagram OAuth is not configured. Set INSTAGRAM_APP_SECRET.");
  }
  return secret;
}

export function buildInstagramAuthorizationUrl(input: OAuthBeginInput): string {
  const params = new URLSearchParams({
    client_id: instagramAppId(),
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: INSTAGRAM_SCOPES,
    state: input.state,
  });

  return `${INSTAGRAM_AUTHORIZE_URL}?${params.toString()}`;
}

export class InstagramAdapter extends BaseSocialAdapter {
  readonly platform = "instagram" as const;
  readonly connectMode = "oauth" as const;

  constructor(private readonly context: AdapterContext = {}) {
    super();
  }

  async beginOAuth(input: OAuthBeginInput): Promise<string> {
    return buildInstagramAuthorizationUrl(input);
  }

  async connect(input?: ConnectInput): Promise<ConnectResult> {
    if (!input?.authorizationCode || !input.redirectUri) {
      throw new ValidationError("Instagram OAuth callback is missing code");
    }

    const shortLivedResponse = await socialFetch(INSTAGRAM_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: instagramAppId(),
        client_secret: instagramAppSecret(),
        grant_type: "authorization_code",
        redirect_uri: input.redirectUri,
        code: input.authorizationCode,
      }),
    });
    const shortLived = await readJson<InstagramShortLivedResponse>(shortLivedResponse);
    if (!shortLived.access_token) {
      throw new AuthenticationError(shortLived.error_message ?? "Instagram token exchange failed");
    }

    const longLivedUrl = new URL(INSTAGRAM_LONG_LIVED_URL);
    longLivedUrl.searchParams.set("grant_type", "ig_exchange_token");
    longLivedUrl.searchParams.set("client_secret", instagramAppSecret());
    longLivedUrl.searchParams.set("access_token", shortLived.access_token);
    const longLivedResponse = await socialFetch(longLivedUrl.toString());
    const longLived = await readJson<InstagramLongLivedResponse>(longLivedResponse);
    const accessToken = longLived.access_token ?? shortLived.access_token;

    const profile = await this.fetchMe(accessToken);
    const expiresAt =
      typeof longLived.expires_in === "number"
        ? new Date(Date.now() + longLived.expires_in * 1000).toISOString()
        : null;

    return {
      ...profile,
      scopes: shortLived.permissions ?? INSTAGRAM_SCOPES.split(","),
      accessToken,
      refreshToken: null,
      tokenExpiresAt: expiresAt,
      metadata: { instagramUserId: profile.externalAccountId },
    };
  }

  async getAccount(): Promise<SocialAccountSnapshot> {
    const token = this.context.accessToken;
    if (!token) {
      throw new AuthenticationError("Instagram account has no access token");
    }

    const profile = await this.fetchMe(token);
    return {
      platform: "instagram",
      ...profile,
      status: "CONNECTED",
    };
  }

  async refreshTokens(): Promise<TokenRefreshResult> {
    const token = this.context.accessToken;
    if (!token) {
      throw new AuthenticationError("Instagram account has no access token");
    }

    const url = new URL(INSTAGRAM_REFRESH_URL);
    url.searchParams.set("grant_type", "ig_refresh_token");
    url.searchParams.set("access_token", token);
    const response = await socialFetch(url.toString());
    const refreshed = await readJson<InstagramLongLivedResponse>(response);
    if (!refreshed.access_token) {
      throw new AuthenticationError("Instagram token refresh failed");
    }

    return {
      accessToken: refreshed.access_token,
      refreshToken: null,
      tokenExpiresAt:
        typeof refreshed.expires_in === "number"
          ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
          : null,
    };
  }

  protected extraCapabilities(): Partial<SocialCapabilities> {
    return { publishing: true };
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const token = this.context.accessToken;
    if (!token) {
      throw new AuthenticationError("Instagram account has no access token");
    }

    const plan = planInstagramPublish(input);
    const userId = await resolveInstagramUserId(token, this.context.metadata);
    return executeInstagramPublish(token, userId, plan);
  }

  protected resolvePublicProfile(source: string) {
    return resolveInstagramPublicProfile(source);
  }

  private async fetchMe(accessToken: string) {
    const url = new URL(INSTAGRAM_ME_URL);
    url.searchParams.set("fields", "id,username,name,profile_picture_url");
    url.searchParams.set("access_token", accessToken);
    const response = await socialFetch(url.toString());
    const payload = await readJson<InstagramMeResponse>(response);
    const externalAccountId = payload.user_id ?? payload.id;
    if (!externalAccountId) {
      throw new AuthenticationError("Instagram /me failed");
    }

    const username = payload.username ? `@${payload.username}` : null;
    return {
      externalAccountId: String(externalAccountId),
      username,
      displayName: payload.name ?? username,
      avatarUrl: payload.profile_picture_url ?? null,
    };
  }
}
