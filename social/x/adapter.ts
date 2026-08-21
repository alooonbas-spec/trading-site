import { z } from "zod";
import { AuthenticationError, SocialError, ValidationError } from "@/lib/errors";
import { matchKeywords, normalizeKeywords } from "@/lib/monitoring/keywords";
import { readJson, socialFetch } from "@/social/core/http";
import {
  BaseSocialAdapter,
  type AdapterContext,
  type ConnectInput,
  type OAuthBeginInput,
} from "@/social/core/base-adapter";
import type {
  ConnectResult,
  MonitorInput,
  MonitorResult,
  PublishInput,
  PublishResult,
  SocialAccountSnapshot,
  SocialCapabilities,
  TokenRefreshResult,
} from "@/social/core/adapter";
import { assertMonitorSourcesAllowed } from "@/social/core/monitor-sources";
import { resolveXPublicProfile } from "@/social/x/public-profile";
import { uploadXMediaFromUrls } from "@/social/x/media-upload";

const X_AUTHORIZE_URL = "https://twitter.com/i/oauth2/authorize";
const X_TOKEN_URL = "https://api.x.com/2/oauth2/token";
const X_REVOKE_URL = "https://api.x.com/2/oauth2/revoke";
const X_ME_URL = "https://api.x.com/2/users/me";
const X_TWEETS_URL = "https://api.x.com/2/tweets";
const X_RECENT_SEARCH_URL = "https://api.x.com/2/tweets/search/recent";
const X_SCOPES = "tweet.read tweet.write users.read media.write offline.access";

type XTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

const xCreateTweetResponseSchema = z.object({
  data: z.object({
    id: z.string().min(1),
    text: z.string().optional(),
  }),
});

const xRecentSearchResponseSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string().min(1),
        text: z.string(),
        author_id: z.string().optional(),
      }),
    )
    .optional(),
  includes: z
    .object({
      users: z
        .array(
          z.object({
            id: z.string(),
            username: z.string().optional(),
            name: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  meta: z
    .object({
      newest_id: z.string().optional(),
      result_count: z.number().optional(),
    })
    .optional(),
});

type XMeResponse = {
  data?: {
    id: string;
    name?: string;
    username?: string;
    profile_image_url?: string;
  };
};

function xClientId(): string {
  const clientId = process.env.X_CLIENT_ID;
  if (!clientId) {
    throw new ValidationError("X OAuth is not configured. Set X_CLIENT_ID.");
  }
  return clientId;
}

function xBasicAuthHeader(): string {
  const clientSecret = process.env.X_CLIENT_SECRET;
  if (!clientSecret) {
    throw new ValidationError("X OAuth is not configured. Set X_CLIENT_SECRET.");
  }

  return `Basic ${Buffer.from(`${xClientId()}:${clientSecret}`).toString("base64")}`;
}

export function buildXAuthorizationUrl(input: OAuthBeginInput): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: xClientId(),
    redirect_uri: input.redirectUri,
    scope: X_SCOPES,
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
  });

  return `${X_AUTHORIZE_URL}?${params.toString()}`;
}

export function buildXRecentSearchQuery(keywords: string[]): string {
  const normalized = normalizeKeywords(keywords);
  if (normalized.length === 0) {
    throw new ValidationError("Monitoring requires at least one keyword");
  }

  return normalized.map((keyword) => `"${keyword.replaceAll('"', "")}"`).join(" OR ");
}

export class XAdapter extends BaseSocialAdapter {
  readonly platform = "x" as const;
  readonly connectMode = "oauth" as const;

  constructor(private readonly context: AdapterContext = {}) {
    super();
  }

  async beginOAuth(input: OAuthBeginInput): Promise<string> {
    return buildXAuthorizationUrl(input);
  }

  async connect(input?: ConnectInput): Promise<ConnectResult> {
    if (!input?.authorizationCode || !input.redirectUri || !input.codeVerifier) {
      throw new ValidationError("X OAuth callback is missing code or PKCE verifier");
    }

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: input.authorizationCode,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
    });

    const response = await socialFetch(X_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: xBasicAuthHeader(),
      },
      body,
    });
    const token = await readJson<XTokenResponse>(response);
    if (!token.access_token) {
      throw new AuthenticationError(token.error_description ?? "X token exchange failed");
    }

    const profile = await this.fetchMe(token.access_token);
    const expiresAt =
      typeof token.expires_in === "number"
        ? new Date(Date.now() + token.expires_in * 1000).toISOString()
        : null;

    return {
      ...profile,
      scopes: token.scope ? token.scope.split(/\s+/) : X_SCOPES.split(" "),
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? null,
      tokenExpiresAt: expiresAt,
    };
  }

  async getAccount(): Promise<SocialAccountSnapshot> {
    const token = this.context.accessToken;
    if (!token) {
      throw new AuthenticationError("X account has no access token");
    }

    const profile = await this.fetchMe(token);
    return {
      platform: "x",
      ...profile,
      status: "CONNECTED",
    };
  }

  async disconnect(): Promise<void> {
    const token = this.context.accessToken;
    if (!token) {
      return;
    }

    await socialFetch(X_REVOKE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: xBasicAuthHeader(),
      },
      body: new URLSearchParams({
        token,
        token_type_hint: "access_token",
      }),
    });
  }

  protected extraCapabilities(): Partial<SocialCapabilities> {
    return { publishing: true, monitoring: true };
  }

  async refreshTokens(): Promise<TokenRefreshResult> {
    const refreshToken = this.context.refreshToken;
    if (!refreshToken) {
      throw new AuthenticationError("X account has no refresh token");
    }

    const response = await socialFetch(X_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: xBasicAuthHeader(),
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    const token = await readJson<XTokenResponse>(response);
    if (!token.access_token) {
      throw new AuthenticationError(token.error_description ?? "X token refresh failed");
    }

    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? refreshToken,
      tokenExpiresAt:
        typeof token.expires_in === "number"
          ? new Date(Date.now() + token.expires_in * 1000).toISOString()
          : null,
      scopes: token.scope ? token.scope.split(/\s+/) : undefined,
    };
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const token = this.context.accessToken;
    if (!token) {
      throw new AuthenticationError("X account has no access token");
    }

    const text = input.body.trim();
    if (!text) {
      throw new ValidationError("X posts require text");
    }

    const mediaIds = await uploadXMediaFromUrls(token, input.media);
    const payload: { text: string; media?: { media_ids: string[] } } = { text };
    if (mediaIds.length > 0) {
      payload.media = { media_ids: mediaIds };
    }

    const response = await socialFetch(X_TWEETS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const parsed = xCreateTweetResponseSchema.safeParse(await readJson<unknown>(response));
    if (!parsed.success) {
      throw new SocialError("X create tweet returned an unexpected payload");
    }

    return {
      externalPostId: parsed.data.data.id,
      publishedAt: new Date().toISOString(),
    };
  }

  async monitor(input: MonitorInput): Promise<MonitorResult> {
    assertMonitorSourcesAllowed("x", input.sources);
    const token = this.context.accessToken;
    if (!token) {
      return super.monitor(input);
    }

    const query = buildXRecentSearchQuery(input.keywords);
    const url = new URL(X_RECENT_SEARCH_URL);
    url.searchParams.set("query", query);
    url.searchParams.set("max_results", "10");
    url.searchParams.set("tweet.fields", "author_id,created_at");
    url.searchParams.set("expansions", "author_id");
    url.searchParams.set("user.fields", "username,name");
    if (input.cursor && /^\d+$/.test(input.cursor)) {
      url.searchParams.set("since_id", input.cursor);
    }

    const response = await socialFetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    const parsed = xRecentSearchResponseSchema.safeParse(await readJson<unknown>(response));
    if (!parsed.success) {
      throw new SocialError("X recent search returned an unexpected payload");
    }

    const users = new Map((parsed.data.includes?.users ?? []).map((user) => [user.id, user]));
    const events = [];
    for (const tweet of parsed.data.data ?? []) {
      const matchedKeywords = matchKeywords(tweet.text, input.keywords);
      if (matchedKeywords.length === 0) {
        continue;
      }
      const author = tweet.author_id ? users.get(tweet.author_id) : undefined;
      events.push({
        externalId: tweet.id,
        author: author?.username ? `@${author.username}` : (author?.name ?? null),
        content: tweet.text,
        url: author?.username ? `https://x.com/${author.username}/status/${tweet.id}` : `https://x.com/i/web/status/${tweet.id}`,
        matchedKeywords,
      });
    }

    return {
      events,
      cursor: parsed.data.meta?.newest_id ?? input.cursor ?? null,
    };
  }

  protected resolvePublicProfile(source: string) {
    return resolveXPublicProfile(source);
  }

  private async fetchMe(accessToken: string) {
    const url = new URL(X_ME_URL);
    url.searchParams.set("user.fields", "profile_image_url");
    const response = await socialFetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const payload = await readJson<XMeResponse>(response);
    if (!payload.data?.id) {
      throw new AuthenticationError("X users/me failed");
    }

    const username = payload.data.username ? `@${payload.data.username}` : null;
    return {
      externalAccountId: payload.data.id,
      username,
      displayName: payload.data.name ?? username,
      avatarUrl: payload.data.profile_image_url ?? null,
    };
  }
}
