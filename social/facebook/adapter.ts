import { AuthenticationError, UnsupportedActionError, ValidationError } from "@/lib/errors";
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
  PublishInput,
  PublishResult,
  SocialAccountSnapshot,
  SocialCapabilities,
  TokenRefreshResult,
} from "@/social/core/adapter";
import {
  FACEBOOK_AUTHORIZE_URL,
  FACEBOOK_GRAPH_ORIGIN,
  FACEBOOK_ME_URL,
  FACEBOOK_SCOPES,
  FACEBOOK_TOKEN_URL,
} from "@/social/facebook/graph";
import { facebookConnectMetadata, listFacebookPages, resolveFacebookPage } from "@/social/facebook/pages";
import { collectFacebookInbox, replyToFacebookComment } from "@/social/facebook/inbox";
import { facebookMessengerRecipientId, sendFacebookPageMessage } from "@/social/facebook/contact";
import { executeFacebookPublish, planFacebookPublish } from "@/social/facebook/publish";
import { resolveFacebookPublicProfile } from "@/social/facebook/public-profile";

export { FACEBOOK_SCOPES, FACEBOOK_GRAPH_ORIGIN, FACEBOOK_GRAPH_VERSION } from "@/social/facebook/graph";

type FacebookTokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: { message?: string };
};

type FacebookMeResponse = {
  id?: string;
  name?: string;
  picture?: { data?: { url?: string } };
};

function facebookAppId(): string {
  const appId = process.env.FACEBOOK_APP_ID;
  if (!appId) {
    throw new ValidationError("Facebook OAuth is not configured. Set FACEBOOK_APP_ID.");
  }
  return appId;
}

function facebookAppSecret(): string {
  const secret = process.env.FACEBOOK_APP_SECRET;
  if (!secret) {
    throw new ValidationError("Facebook OAuth is not configured. Set FACEBOOK_APP_SECRET.");
  }
  return secret;
}

export function buildFacebookAuthorizationUrl(input: OAuthBeginInput): string {
  const params = new URLSearchParams({
    client_id: facebookAppId(),
    redirect_uri: input.redirectUri,
    state: input.state,
    response_type: "code",
    scope: FACEBOOK_SCOPES,
  });

  return `${FACEBOOK_AUTHORIZE_URL}?${params.toString()}`;
}

export class FacebookAdapter extends BaseSocialAdapter {
  readonly platform = "facebook" as const;
  readonly connectMode = "oauth" as const;

  constructor(private readonly context: AdapterContext = {}) {
    super();
  }

  async beginOAuth(input: OAuthBeginInput): Promise<string> {
    return buildFacebookAuthorizationUrl(input);
  }

  async connect(input?: ConnectInput): Promise<ConnectResult> {
    if (!input?.authorizationCode || !input.redirectUri) {
      throw new ValidationError("Facebook OAuth callback is missing code");
    }

    const url = new URL(FACEBOOK_TOKEN_URL);
    url.searchParams.set("client_id", facebookAppId());
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("client_secret", facebookAppSecret());
    url.searchParams.set("code", input.authorizationCode);

    const response = await socialFetch(url.toString());
    const token = await readJson<FacebookTokenResponse>(response);
    if (!token.access_token) {
      throw new AuthenticationError(token.error?.message ?? "Facebook token exchange failed");
    }

    const profile = await this.fetchMe(token.access_token);
    const pages = await listFacebookPages(token.access_token);
    const expiresAt =
      typeof token.expires_in === "number"
        ? new Date(Date.now() + token.expires_in * 1000).toISOString()
        : null;

    return {
      ...profile,
      scopes: FACEBOOK_SCOPES.split(","),
      accessToken: token.access_token,
      refreshToken: null,
      tokenExpiresAt: expiresAt,
      metadata: facebookConnectMetadata(pages),
    };
  }

  async getAccount(): Promise<SocialAccountSnapshot> {
    const token = this.context.accessToken;
    if (!token) {
      throw new AuthenticationError("Facebook account has no access token");
    }

    const profile = await this.fetchMe(token);
    return {
      platform: "facebook",
      ...profile,
      status: "CONNECTED",
    };
  }

  async refreshTokens(): Promise<TokenRefreshResult> {
    const token = this.context.accessToken;
    if (!token) {
      throw new AuthenticationError("Facebook account has no access token");
    }

    const url = new URL(FACEBOOK_TOKEN_URL);
    url.searchParams.set("grant_type", "fb_exchange_token");
    url.searchParams.set("client_id", facebookAppId());
    url.searchParams.set("client_secret", facebookAppSecret());
    url.searchParams.set("fb_exchange_token", token);
    const response = await socialFetch(url.toString());
    const exchanged = await readJson<FacebookTokenResponse>(response);
    if (!exchanged.access_token) {
      throw new AuthenticationError(exchanged.error?.message ?? "Facebook token refresh failed");
    }

    return {
      accessToken: exchanged.access_token,
      refreshToken: null,
      tokenExpiresAt:
        typeof exchanged.expires_in === "number"
          ? new Date(Date.now() + exchanged.expires_in * 1000).toISOString()
          : null,
    };
  }

  async disconnect(): Promise<void> {
    const token = this.context.accessToken;
    if (!token) {
      return;
    }

    const url = new URL(`${FACEBOOK_GRAPH_ORIGIN}/me/permissions`);
    url.searchParams.set("access_token", token);
    await socialFetch(url.toString(), { method: "DELETE" });
  }

  protected extraCapabilities(): Partial<SocialCapabilities> {
    return { publishing: true, inbox: true, inboxReply: true, contactActions: true, messaging: true };
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const token = this.context.accessToken;
    if (!token) {
      throw new AuthenticationError("Facebook account has no access token");
    }

    const plan = planFacebookPublish(input);
    const page = await resolveFacebookPage(token, this.context.metadata);
    return executeFacebookPublish(page, plan);
  }

  async collectInbox(input: InboxInput): Promise<InboxResult> {
    const token = this.context.accessToken;
    if (!token) {
      throw new AuthenticationError("Facebook account has no access token");
    }
    return collectFacebookInbox(token, this.context.metadata, input);
  }

  async replyToInbox(input: InboxReplyInput): Promise<InboxReplyResult> {
    const token = this.context.accessToken;
    if (!token) {
      throw new AuthenticationError("Facebook account has no access token");
    }

    const text = input.body.trim();
    if (!text) {
      throw new ValidationError("Facebook inbox replies require a body");
    }

    const page = await resolveFacebookPage(token, this.context.metadata);
    if (input.kind === "direct_message") {
      const sent = await sendFacebookPageMessage(page, {
        recipientId: facebookMessengerRecipientId(input.target),
        text,
      });
      return { externalMessageId: sent.externalMessageId };
    }

    if (input.kind === "comment") {
      const sent = await replyToFacebookComment(page, {
        commentId: input.externalEventId,
        text,
      });
      return { externalMessageId: sent.externalMessageId };
    }

    throw new UnsupportedActionError("Facebook cannot send a mention inbox reply");
  }

  async executeContactAction(input: ContactActionInput): Promise<ContactActionResult> {
    if (input.action !== "MESSAGE") {
      throw new UnsupportedActionError("Facebook Pages can send Messenger replies but cannot invite contacts");
    }

    const token = this.context.accessToken;
    if (!token) {
      throw new AuthenticationError("Facebook account has no access token");
    }

    const text = input.body?.trim();
    if (!text) {
      throw new ValidationError("Facebook Messenger messages require a body");
    }
    if (!input.target) {
      throw new ValidationError("Facebook contact requires a social profile target");
    }

    const recipientId = facebookMessengerRecipientId(input.target);
    const page = await resolveFacebookPage(token, this.context.metadata);
    const sent = await sendFacebookPageMessage(page, {
      recipientId,
      text,
    });
    return {
      status: "SUCCESS",
      externalMessageId: sent.externalMessageId,
    };
  }

  protected resolvePublicProfile(source: string) {
    return resolveFacebookPublicProfile(source);
  }

  private async fetchMe(accessToken: string) {
    const url = new URL(FACEBOOK_ME_URL);
    url.searchParams.set("fields", "id,name,picture");
    url.searchParams.set("access_token", accessToken);
    const response = await socialFetch(url.toString());
    const payload = await readJson<FacebookMeResponse>(response);
    if (!payload.id) {
      throw new AuthenticationError("Facebook /me failed");
    }

    return {
      externalAccountId: payload.id,
      username: payload.name ?? null,
      displayName: payload.name ?? null,
      avatarUrl: payload.picture?.data?.url ?? null,
    };
  }
}
