import { z } from "zod";
import { AuthenticationError, SocialError, UnsupportedActionError, ValidationError } from "@/lib/errors";
import { readJson, socialFetch } from "@/social/core/http";
import {
  BaseSocialAdapter,
  type AdapterContext,
  type ConnectInput,
  type OAuthBeginInput,
} from "@/social/core/base-adapter";
import type {
  ConnectResult,
  ContactActionInput,
  ContactActionResult,
  InboxInput,
  InboxReplyInput,
  InboxReplyResult,
  InboxResult,
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
import { collectXInbox, sendXMentionReply } from "@/social/x/inbox";
import { collectXRecentSearch } from "@/social/x/monitor";
export { buildXRecentSearchQuery } from "@/social/x/monitor";
import { resolveXDmParticipantId, sendXDirectMessage } from "@/social/x/contact";

const X_AUTHORIZE_URL = "https://twitter.com/i/oauth2/authorize";
const X_TOKEN_URL = "https://api.x.com/2/oauth2/token";
const X_REVOKE_URL = "https://api.x.com/2/oauth2/revoke";
const X_ME_URL = "https://api.x.com/2/users/me";
const X_TWEETS_URL = "https://api.x.com/2/tweets";
export const X_SCOPES = "tweet.read tweet.write users.read media.write dm.read dm.write offline.access";

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
    return {
      publishing: true,
      monitoring: true,
      inbox: true,
      inboxReply: true,
      contactActions: true,
      messaging: true,
    };
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
    return collectXRecentSearch(token, input);
  }

  async collectInbox(input: InboxInput): Promise<InboxResult> {
    const token = this.context.accessToken;
    if (!token) {
      throw new AuthenticationError("X account has no access token");
    }
    return collectXInbox(token, input);
  }

  async replyToInbox(input: InboxReplyInput): Promise<InboxReplyResult> {
    const token = this.context.accessToken;
    if (!token) {
      throw new AuthenticationError("X account has no access token");
    }

    const text = input.body.trim();
    if (!text) {
      throw new ValidationError("X inbox replies require a body");
    }

    if (input.kind === "direct_message") {
      const participantId = await resolveXDmParticipantId(token, input.target);
      const sent = await sendXDirectMessage(token, { participantId, text });
      return { externalMessageId: sent.externalMessageId };
    }

    if (input.kind === "mention") {
      const sent = await sendXMentionReply(token, { tweetId: input.externalEventId, text });
      return { externalMessageId: sent.externalMessageId };
    }

    throw new UnsupportedActionError("X cannot send a comment inbox reply");
  }

  async executeContactAction(input: ContactActionInput): Promise<ContactActionResult> {
    if (input.action !== "MESSAGE") {
      throw new UnsupportedActionError("X can send Direct Messages but cannot invite contacts");
    }

    const token = this.context.accessToken;
    if (!token) {
      throw new AuthenticationError("X account has no access token");
    }

    const text = input.body?.trim();
    if (!text) {
      throw new ValidationError("X Direct Messages require a body");
    }
    if (!input.target) {
      throw new ValidationError("X contact requires a social profile target");
    }

    const participantId = await resolveXDmParticipantId(token, input.target);
    const sent = await sendXDirectMessage(token, { participantId, text });
    return {
      status: "SUCCESS",
      externalMessageId: sent.externalMessageId,
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
