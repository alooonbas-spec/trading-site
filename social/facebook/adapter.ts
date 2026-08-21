import { AuthenticationError, ValidationError } from "@/lib/errors";
import { readJson, socialFetch } from "@/social/core/http";
import {
  BaseSocialAdapter,
  type AdapterContext,
  type ConnectInput,
  type OAuthBeginInput,
} from "@/social/core/base-adapter";
import type { ConnectResult, SocialAccountSnapshot } from "@/social/core/adapter";
import { resolveFacebookPublicProfile } from "@/social/facebook/public-profile";

const FACEBOOK_GRAPH_VERSION = "v25.0";
const FACEBOOK_AUTHORIZE_URL = `https://www.facebook.com/${FACEBOOK_GRAPH_VERSION}/dialog/oauth`;
const FACEBOOK_TOKEN_URL = `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/oauth/access_token`;
const FACEBOOK_ME_URL = `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/me`;
const FACEBOOK_SCOPES = "pages_show_list,pages_read_engagement";

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

  async disconnect(): Promise<void> {
    const token = this.context.accessToken;
    if (!token) {
      return;
    }

    const url = new URL(`https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/me/permissions`);
    url.searchParams.set("access_token", token);
    await socialFetch(url.toString(), { method: "DELETE" });
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
