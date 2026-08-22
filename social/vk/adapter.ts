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
  MonitorInput,
  MonitorResult,
  PublishInput,
  PublishResult,
  SocialAccountSnapshot,
  SocialCapabilities,
  TokenRefreshResult,
} from "@/social/core/adapter";
import { VK_SCOPES } from "@/social/vk/api";
import { executeVkPublish, planVkPublish } from "@/social/vk/publish";
import { collectVkInbox, replyToVkPhotoComment, replyToVkPhotoTag, replyToVkUserPhotoComment, replyToVkVideoComment, replyToVkWallComment, replyToVkWallMention } from "@/social/vk/inbox";
import { collectVkNewsfeedSearch, vkMonitorAccessToken } from "@/social/vk/monitor";
import { connectVkCommunity, fetchVkCommunity, isVkCommunityAccount, vkCommunityGroupId } from "@/social/vk/community";
import { resolveVkCommunityPeerId, sendVkCommunityMessage } from "@/social/vk/contact";
import { resolveVkPublicProfile } from "@/social/vk/public-profile";
import { assertMonitorSourcesAllowed } from "@/social/core/monitor-sources";

export { VK_SCOPES } from "@/social/vk/api";

const VK_AUTHORIZE_URL = "https://id.vk.ru/authorize";
const VK_TOKEN_URL = "https://id.vk.ru/oauth2/auth";
const VK_USER_INFO_URL = "https://id.vk.ru/oauth2/user_info";
const VK_LOGOUT_URL = "https://id.vk.ru/oauth2/logout";

type VkTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user_id?: number | string;
  scope?: string;
  error?: string;
  error_description?: string;
};

type VkUserInfoResponse = {
  user?: {
    user_id?: string;
    first_name?: string;
    last_name?: string;
    avatar?: string;
  };
  error?: string;
  error_description?: string;
};

function vkClientId(): string {
  const clientId = process.env.VK_CLIENT_ID;
  if (!clientId) {
    throw new ValidationError("VK OAuth is not configured. Set VK_CLIENT_ID.");
  }
  return clientId;
}

export function buildVkAuthorizationUrl(input: OAuthBeginInput): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: vkClientId(),
    redirect_uri: input.redirectUri,
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    scope: VK_SCOPES,
  });

  return `${VK_AUTHORIZE_URL}?${params.toString()}`;
}

export class VkAdapter extends BaseSocialAdapter {
  readonly platform = "vk" as const;
  readonly connectMode = "oauth" as const;

  constructor(private readonly context: AdapterContext = {}) {
    super();
  }

  async beginOAuth(input: OAuthBeginInput): Promise<string> {
    return buildVkAuthorizationUrl(input);
  }

  async connect(input?: ConnectInput): Promise<ConnectResult> {
    if (input?.credential) {
      return connectVkCommunity({
        token: input.credential,
        groupRef: input.accountHint ?? "",
      });
    }

    if (!input?.authorizationCode || !input.redirectUri || !input.codeVerifier || !input.deviceId || !input.oauthState) {
      throw new ValidationError("VK OAuth callback is missing code, device_id, or PKCE verifier");
    }

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code_verifier: input.codeVerifier,
      redirect_uri: input.redirectUri,
      code: input.authorizationCode,
      client_id: vkClientId(),
      device_id: input.deviceId,
      state: input.oauthState,
    });

    const serviceToken = process.env.VK_SERVICE_TOKEN;
    if (serviceToken) {
      body.set("service_token", serviceToken);
    }

    const response = await socialFetch(VK_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const token = await readJson<VkTokenResponse>(response);

    if (!token.access_token || token.user_id === undefined) {
      throw new AuthenticationError(token.error_description ?? "VK token exchange failed");
    }

    const profile = await this.fetchUser(token.access_token);
    const expiresAt =
      typeof token.expires_in === "number"
        ? new Date(Date.now() + token.expires_in * 1000).toISOString()
        : null;

    return {
      externalAccountId: String(token.user_id),
      username: profile.username,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      scopes: token.scope ? token.scope.split(/\s+/) : VK_SCOPES.split(/\s+/),
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? null,
      tokenExpiresAt: expiresAt,
    };
  }

  async getAccount(): Promise<SocialAccountSnapshot> {
    const token = this.context.accessToken;
    if (!token) {
      throw new AuthenticationError("VK account has no access token");
    }

    if (isVkCommunityAccount(this.context.metadata)) {
      const group = await fetchVkCommunity(token, vkCommunityGroupId(this.context.metadata));
      return {
        platform: "vk",
        externalAccountId: String(group.id),
        username: group.screen_name ?? null,
        displayName: group.name ?? group.screen_name ?? String(group.id),
        avatarUrl: group.photo_200 ?? null,
        status: "CONNECTED",
      };
    }

    const profile = await this.fetchUser(token);
    return {
      platform: "vk",
      externalAccountId: profile.externalAccountId,
      username: profile.username,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      status: "CONNECTED",
    };
  }

  async refreshTokens(): Promise<TokenRefreshResult> {
    if (isVkCommunityAccount(this.context.metadata)) {
      throw new UnsupportedActionError("VK community tokens are not refreshable");
    }
    const refreshToken = this.context.refreshToken;
    const deviceId = this.context.metadata?.deviceId;
    if (!refreshToken) {
      throw new AuthenticationError("VK account has no refresh token");
    }
    if (typeof deviceId !== "string" || !deviceId) {
      throw new AuthenticationError("VK token refresh requires the original device_id");
    }

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: vkClientId(),
      device_id: deviceId,
    });
    const serviceToken = process.env.VK_SERVICE_TOKEN;
    if (serviceToken) {
      body.set("service_token", serviceToken);
    }

    const response = await socialFetch(VK_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const token = await readJson<VkTokenResponse>(response);
    if (!token.access_token) {
      throw new AuthenticationError(token.error_description ?? "VK token refresh failed");
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

  async disconnect(): Promise<void> {
    if (isVkCommunityAccount(this.context.metadata)) {
      return;
    }
    const token = this.context.accessToken;
    if (!token) {
      return;
    }

    const body = new URLSearchParams({
      client_id: vkClientId(),
      access_token: token,
    });

    await socialFetch(VK_LOGOUT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  }

  protected extraCapabilities(): Partial<SocialCapabilities> {
    if (isVkCommunityAccount(this.context.metadata)) {
      return {
        publishing: true,
        inbox: true,
        inboxReply: true,
        monitoring: true,
        contactActions: true,
        messaging: true,
      };
    }
    return { publishing: true, inbox: true, inboxReply: true, monitoring: true };
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const token = this.context.accessToken;
    if (!token) {
      throw new AuthenticationError("VK account has no access token");
    }

    const plan = planVkPublish(input);
    return executeVkPublish(token, plan, this.context.metadata);
  }

  async collectInbox(input: InboxInput): Promise<InboxResult> {
    const token = this.context.accessToken;
    if (!token) {
      throw new AuthenticationError("VK account has no access token");
    }
    return collectVkInbox(token, this.context.metadata, input);
  }

  async replyToInbox(input: InboxReplyInput): Promise<InboxReplyResult> {
    const token = this.context.accessToken;
    if (!token) {
      throw new AuthenticationError("VK account has no access token");
    }

    if (input.kind === "direct_message") {
      if (!isVkCommunityAccount(this.context.metadata)) {
        throw new UnsupportedActionError(
          "VK can reply to wall comments. User Direct Messages are not enabled for new apps. Connect a community token with messages.",
        );
      }
      const text = input.body.trim();
      if (!text) {
        throw new ValidationError("VK community messages require a body");
      }
      const sent = await sendVkCommunityMessage(token, {
        peerId: await resolveVkCommunityPeerId(token, input.target),
        text,
      });
      return { externalMessageId: sent.externalMessageId };
    }

    if (input.kind === "mention") {
      if (input.externalEventId.startsWith("phototag:")) {
        const sent = await replyToVkPhotoTag(token, {
          externalId: input.externalEventId,
          text: input.body,
        });
        return { externalMessageId: sent.externalMessageId };
      }
      const sent = await replyToVkWallMention(token, {
        externalId: input.externalEventId,
        text: input.body,
      });
      return { externalMessageId: sent.externalMessageId };
    }

    if (input.kind !== "comment") {
      throw new UnsupportedActionError(
        "VK can reply to wall comments, photo comments, video comments, and mentions. User Direct Messages are not enabled for new apps.",
      );
    }

    if (input.externalEventId.startsWith("video:")) {
      const sent = await replyToVkVideoComment(token, {
        externalId: input.externalEventId,
        text: input.body,
      });
      return { externalMessageId: sent.externalMessageId };
    }

    if (input.externalEventId.startsWith("phototag:")) {
      const sent = await replyToVkUserPhotoComment(token, {
        externalId: input.externalEventId,
        text: input.body,
      });
      return { externalMessageId: sent.externalMessageId };
    }

    if (input.externalEventId.startsWith("photo:")) {
      const sent = await replyToVkPhotoComment(token, {
        externalId: input.externalEventId,
        text: input.body,
      });
      return { externalMessageId: sent.externalMessageId };
    }

    const sent = await replyToVkWallComment(token, {
      externalId: input.externalEventId,
      text: input.body,
    });
    return { externalMessageId: sent.externalMessageId };
  }

  async executeContactAction(input: ContactActionInput): Promise<ContactActionResult> {
    if (input.action !== "MESSAGE") {
      throw new UnsupportedActionError("VK communities can send messages but cannot invite contacts");
    }
    if (!isVkCommunityAccount(this.context.metadata)) {
      throw new UnsupportedActionError(
        "VK user Direct Messages are not enabled for new apps. Connect a community token with messages.",
      );
    }

    const token = this.context.accessToken;
    if (!token) {
      throw new AuthenticationError("VK account has no access token");
    }
    const text = input.body?.trim();
    if (!text) {
      throw new ValidationError("VK community messages require a body");
    }
    if (!input.target) {
      throw new ValidationError("VK contact requires a social profile target");
    }

    const sent = await sendVkCommunityMessage(token, {
      peerId: await resolveVkCommunityPeerId(token, input.target),
      text,
    });
    return {
      status: "SUCCESS",
      externalMessageId: sent.externalMessageId,
    };
  }

  async monitor(input: MonitorInput): Promise<MonitorResult> {
    assertMonitorSourcesAllowed("vk", input.sources);
    if (isVkCommunityAccount(this.context.metadata)) {
      return super.monitor(input);
    }
    const token = vkMonitorAccessToken(this.context.accessToken);
    if (!token) {
      return super.monitor(input);
    }
    return collectVkNewsfeedSearch(token, input);
  }

  protected resolvePublicProfile(source: string) {
    return resolveVkPublicProfile(source);
  }

  private async fetchUser(accessToken: string) {
    const response = await socialFetch(VK_USER_INFO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: vkClientId(),
        access_token: accessToken,
      }),
    });
    const payload = await readJson<VkUserInfoResponse>(response);
    const user = payload.user;
    if (!user?.user_id) {
      throw new AuthenticationError(payload.error_description ?? "VK user_info failed");
    }

    const displayName = [user.first_name, user.last_name].filter(Boolean).join(" ") || null;
    return {
      externalAccountId: user.user_id,
      username: displayName,
      displayName,
      avatarUrl: user.avatar ?? null,
    };
  }
}
