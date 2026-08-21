import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthenticationError, UnsupportedActionError, ValidationError } from "@/lib/errors";
import { getSocialAdapter } from "@/social/core/registry";
import {
  TelegramAdapter,
  normalizeTelegramChatId,
  telegramChatIdFromTarget,
  telegramMethodUrl,
  telegramPublishChatId,
} from "@/social/telegram/adapter";
import { InstagramAdapter } from "@/social/instagram/adapter";
import { XAdapter } from "@/social/x/adapter";
import { SOCIAL_PLATFORMS } from "@/types/social";

describe("PHASE 9 token refresh", () => {
  afterEach(() => {
    delete process.env.X_CLIENT_ID;
    delete process.env.X_CLIENT_SECRET;
    vi.unstubAllGlobals();
  });

  it("refreshes X tokens through the official OAuth token endpoint", async () => {
    process.env.X_CLIENT_ID = "x-app";
    process.env.X_CLIENT_SECRET = "x-secret";
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.x.com/2/oauth2/token");
      expect(init?.method).toBe("POST");
      expect(String(init?.body)).toContain("grant_type=refresh_token");
      expect(String(init?.body)).toContain("refresh_token=old-refresh");
      return new Response(
        JSON.stringify({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 7200,
          scope: "tweet.read tweet.write users.read media.write offline.access",
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const refreshed = await new XAdapter({
      accessToken: "old-access",
      refreshToken: "old-refresh",
    }).refreshTokens();
    expect(refreshed.accessToken).toBe("new-access");
    expect(refreshed.refreshToken).toBe("new-refresh");
    expect(refreshed.tokenExpiresAt).toEqual(expect.any(String));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the previous X refresh token when the provider omits a new one", async () => {
    process.env.X_CLIENT_ID = "x-app";
    process.env.X_CLIENT_SECRET = "x-secret";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ access_token: "new-access", expires_in: 3600 }), { status: 200 }),
      ),
    );

    const refreshed = await new XAdapter({
      accessToken: "old-access",
      refreshToken: "old-refresh",
    }).refreshTokens();
    expect(refreshed.refreshToken).toBe("old-refresh");
  });

  it("refreshes Instagram long-lived tokens through graph.instagram.com", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const parsed = new URL(String(url));
      expect(parsed.origin + parsed.pathname).toBe("https://graph.instagram.com/refresh_access_token");
      expect(parsed.searchParams.get("grant_type")).toBe("ig_refresh_token");
      expect(parsed.searchParams.get("access_token")).toBe("ig-token");
      return new Response(
        JSON.stringify({ access_token: "ig-refreshed", expires_in: 5184000 }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const refreshed = await new InstagramAdapter({ accessToken: "ig-token" }).refreshTokens();
    expect(refreshed.accessToken).toBe("ig-refreshed");
    expect(refreshed.refreshToken).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not invent Telegram token refresh", async () => {
    await expect(new TelegramAdapter({ accessToken: "123456:ABC" }).refreshTokens()).rejects.toBeInstanceOf(
      UnsupportedActionError,
    );
  });
});

describe("PHASE 9 Telegram sendMessage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("enables Telegram text publishing and messaging without TinyFish", async () => {
    const capabilities = await getSocialAdapter("telegram").getCapabilities();
    expect(capabilities.publishing).toBe(true);
    expect(capabilities.contactActions).toBe(true);
    expect(capabilities.messaging).toBe(true);
  });

  it("publishes text through official sendMessage", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(telegramMethodUrl("123456:ABC-token_value", "sendMessage"));
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ chat_id: "@hub_channel", text: "Hello channel" });
      return new Response(
        JSON.stringify({
          ok: true,
          result: { message_id: 9, chat: { id: -100, username: "hub_channel" } },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const published = await new TelegramAdapter({
      accessToken: "123456:ABC-token_value",
      metadata: { publishChatId: "hub_channel" },
    }).publish({
      workspaceId: "w",
      socialAccountId: "a",
      body: "Hello channel",
      media: [],
    });
    expect(published.externalPostId).toBe("-100:9");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends MESSAGE to the profile chat and refuses INVITE", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(telegramMethodUrl("123456:ABC-token_value", "sendMessage"));
      expect(JSON.parse(String(init?.body))).toEqual({ chat_id: "@lead_user", text: "Hello lead" });
      return new Response(
        JSON.stringify({
          ok: true,
          result: { message_id: 4, chat: { id: 77, username: "lead_user" } },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new TelegramAdapter({ accessToken: "123456:ABC-token_value" });
    const sent = await adapter.executeContactAction({
      workspaceId: "w",
      socialAccountId: "a",
      socialProfileId: "p",
      leadId: "l",
      action: "MESSAGE",
      body: "Hello lead",
      target: { externalProfileId: "77", username: "lead_user" },
    });
    expect(sent.status).toBe("SUCCESS");
    expect(sent.externalMessageId).toBe("77:4");

    await expect(
      adapter.executeContactAction({
        workspaceId: "w",
        socialAccountId: "a",
        socialProfileId: "p",
        leadId: "l",
        action: "INVITE",
        target: { externalProfileId: "77", username: "lead_user" },
      }),
    ).rejects.toBeInstanceOf(UnsupportedActionError);
  });

  it("fails Telegram MESSAGE honestly without a bot token", async () => {
    await expect(
      new TelegramAdapter().executeContactAction({
        workspaceId: "w",
        socialAccountId: "a",
        socialProfileId: "p",
        leadId: "l",
        action: "MESSAGE",
        body: "Hello",
        target: { externalProfileId: "1", username: "user" },
      }),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("normalizes channel usernames and numeric chat ids", () => {
    expect(normalizeTelegramChatId("@Channel")).toBe("@Channel");
    expect(normalizeTelegramChatId("channel")).toBe("@channel");
    expect(normalizeTelegramChatId("-100123")).toBe("-100123");
    expect(telegramPublishChatId({ publishChatId: "news" })).toBe("@news");
    expect(telegramChatIdFromTarget({ externalProfileId: "42", username: null })).toBe("42");
    expect(telegramChatIdFromTarget({ externalProfileId: "user", username: "lead" })).toBe("@lead");
    expect(() => telegramPublishChatId({})).toThrow(ValidationError);
  });
});

describe("PHASE 9 source boundaries", () => {
  it("keeps platform switches out of the worker and token refresh helper", () => {
    const worker = readFileSync("services/jobs/worker-service.ts", "utf8");
    const refresh = readFileSync("services/social-accounts/token-refresh-service.ts", "utf8");
    for (const source of [worker, refresh]) {
      expect(source).not.toMatch(/platform\s*===\s*["']telegram["']/);
      expect(source).not.toMatch(/if\s*\(\s*platform\s*===/);
    }
    expect(worker).toContain("prepareAccountAdapter");
    expect(worker).toContain("target:");
    expect(refresh).toContain("adapter.refreshTokens");
  });

  it("registers refreshTokens on every adapter", () => {
    for (const platform of SOCIAL_PLATFORMS) {
      expect(typeof getSocialAdapter(platform).refreshTokens).toBe("function");
    }
  });
});
