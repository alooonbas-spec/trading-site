import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthenticationError, UnsupportedActionError, ValidationError } from "@/lib/errors";
import { redactSensitiveUrl } from "@/social/core/http";
import { getSocialAdapter, listSocialPlatforms } from "@/social/core/registry";
import { TelegramAdapter, telegramMethodUrl } from "@/social/telegram/adapter";
import { buildVkAuthorizationUrl } from "@/social/vk/adapter";
import { buildXAuthorizationUrl } from "@/social/x/adapter";
import { buildFacebookAuthorizationUrl } from "@/social/facebook/adapter";
import { buildInstagramAuthorizationUrl } from "@/social/instagram/adapter";
import { SOCIAL_PLATFORMS } from "@/types/social";

describe("adapter registry", () => {
  it("registers every platform without a service-level platform switch", () => {
    expect(listSocialPlatforms()).toEqual([...SOCIAL_PLATFORMS]);
    for (const platform of SOCIAL_PLATFORMS) {
      const adapter = getSocialAdapter(platform);
      expect(adapter.platform).toBe(platform);
    }

    const accountService = readFileSync("services/social-accounts/account-service.ts", "utf8");
    expect(accountService).not.toMatch(/platform\s*===\s*["']telegram["']/);
    expect(accountService).not.toMatch(/if\s*\(\s*platform\s*===/);
  });
});

describe("PHASE 2 adapter capabilities", () => {
  afterEach(() => {
    delete process.env.TINYFISH_API_KEY;
  });

  it("keeps VK contact actions disabled while official publishing is enabled", async () => {
    const adapter = getSocialAdapter("vk");
    const capabilities = await adapter.getCapabilities();
    expect(capabilities.publishing).toBe(true);
    expect(capabilities.contactActions).toBe(false);
    expect(capabilities.publicCollection).toBe(false);
    expect(capabilities.monitoring).toBe(true);
    await expect(
      adapter.monitor({ workspaceId: "w", socialAccountId: null, keywords: ["hello"], sources: [] }),
    ).rejects.toBeInstanceOf(UnsupportedActionError);
    await expect(
      adapter.executeContactAction({
        workspaceId: "w",
        socialAccountId: "a",
        socialProfileId: "p",
        leadId: "l",
        action: "MESSAGE",
      }),
    ).rejects.toBeInstanceOf(UnsupportedActionError);
  });

  it("refuses public collection until TINYFISH_API_KEY is configured", async () => {
    const adapter = getSocialAdapter("telegram");
    expect((await adapter.getCapabilities()).publicCollection).toBe(false);
    await expect(
      adapter.collectPublicData({ workspaceId: "w", source: "durov" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("enables publicCollection when TINYFISH_API_KEY is set and still disables contact actions", async () => {
    process.env.TINYFISH_API_KEY = "test-key";
    const adapter = getSocialAdapter("vk");
    const capabilities = await adapter.getCapabilities();
    expect(capabilities.publicCollection).toBe(true);
    expect(capabilities.contactActions).toBe(false);
    expect(capabilities.publishing).toBe(true);
    expect(capabilities.monitoring).toBe(true);
  });
});

describe("OAuth URL builders", () => {
  afterEach(() => {
    delete process.env.VK_CLIENT_ID;
    delete process.env.X_CLIENT_ID;
    delete process.env.FACEBOOK_APP_ID;
    delete process.env.INSTAGRAM_APP_ID;
  });

  it("builds official VK, X, Facebook, and Instagram authorize URLs", () => {
    process.env.VK_CLIENT_ID = "vk-app";
    process.env.X_CLIENT_ID = "x-app";
    process.env.FACEBOOK_APP_ID = "fb-app";
    process.env.INSTAGRAM_APP_ID = "ig-app";

    const input = {
      redirectUri: "http://localhost:3000/api/social/vk/callback",
      state: "state-value-at-least-32-characters-long",
      codeChallenge: "challenge",
    };

    expect(buildVkAuthorizationUrl(input)).toContain("https://id.vk.ru/authorize?");
    expect(buildVkAuthorizationUrl(input)).toContain("code_challenge_method=S256");
    expect(buildXAuthorizationUrl({ ...input, redirectUri: "http://localhost:3000/api/social/x/callback" })).toContain(
      "https://twitter.com/i/oauth2/authorize?",
    );
    expect(
      buildXAuthorizationUrl({ ...input, redirectUri: "http://localhost:3000/api/social/x/callback" }),
    ).toContain("media.write");
    expect(
      buildXAuthorizationUrl({ ...input, redirectUri: "http://localhost:3000/api/social/x/callback" }),
    ).toContain("dm.read");
    expect(
      buildXAuthorizationUrl({ ...input, redirectUri: "http://localhost:3000/api/social/x/callback" }),
    ).toContain("dm.write");
    expect(buildVkAuthorizationUrl(input)).toContain("wall");
    expect(buildVkAuthorizationUrl(input)).toContain("photos");
    expect(
      buildFacebookAuthorizationUrl({
        ...input,
        redirectUri: "http://localhost:3000/api/social/facebook/callback",
      }),
    ).toContain("https://www.facebook.com/v25.0/dialog/oauth?");
    expect(
      buildFacebookAuthorizationUrl({
        ...input,
        redirectUri: "http://localhost:3000/api/social/facebook/callback",
      }),
    ).toContain("pages_manage_posts");
    expect(
      buildFacebookAuthorizationUrl({
        ...input,
        redirectUri: "http://localhost:3000/api/social/facebook/callback",
      }),
    ).toContain("pages_messaging");
    expect(
      buildInstagramAuthorizationUrl({
        ...input,
        redirectUri: "http://localhost:3000/api/social/instagram/callback",
      }),
    ).toContain("https://www.instagram.com/oauth/authorize?");
    expect(
      buildInstagramAuthorizationUrl({
        ...input,
        redirectUri: "http://localhost:3000/api/social/instagram/callback",
      }),
    ).toContain("instagram_business_content_publish");
    expect(
      buildInstagramAuthorizationUrl({
        ...input,
        redirectUri: "http://localhost:3000/api/social/instagram/callback",
      }),
    ).toContain("instagram_business_manage_comments");
    expect(
      buildInstagramAuthorizationUrl({
        ...input,
        redirectUri: "http://localhost:3000/api/social/instagram/callback",
      }),
    ).toContain("instagram_business_manage_messages");
  });

  it("refuses OAuth when platform credentials are missing", () => {
    const input = {
      redirectUri: "http://localhost:3000/callback",
      state: "state-value-at-least-32-characters-long",
      codeChallenge: "challenge",
    };
    expect(() => buildVkAuthorizationUrl(input)).toThrow(ValidationError);
    expect(() => buildXAuthorizationUrl(input)).toThrow(ValidationError);
    expect(() => buildFacebookAuthorizationUrl(input)).toThrow(ValidationError);
    expect(() => buildInstagramAuthorizationUrl(input)).toThrow(ValidationError);
  });
});

describe("Telegram adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("connects through getMe and never returns a fake success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ok: true,
            result: { id: 42, is_bot: true, first_name: "Hub", username: "hub_bot" },
          }),
          { status: 200 },
        ),
      ),
    );

    const adapter = new TelegramAdapter();
    const connected = await adapter.connect({ credential: "123456:ABC-token_value" });
    expect(connected.externalAccountId).toBe("42");
    expect(connected.username).toBe("@hub_bot");
    expect(connected.accessToken).toBe("123456:ABC-token_value");
  });

  it("treats HTTP 401 and Telegram ok:false as authentication failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unauthorized", { status: 401 })));
    await expect(new TelegramAdapter().connect({ credential: "123456:ABC-token_value" })).rejects.toBeInstanceOf(
      AuthenticationError,
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: false, description: "Unauthorized" }), { status: 200 }),
      ),
    );
    await expect(new TelegramAdapter().connect({ credential: "123456:ABC-token_value" })).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });
});

describe("Telegram URL redaction", () => {
  it("strips bot tokens from request URLs", () => {
    const url = telegramMethodUrl("123456:SECRET", "getMe");
    expect(url).toContain("/bot123456:SECRET/getMe");
    expect(redactSensitiveUrl(url)).toBe("https://api.telegram.org/bot[redacted]/getMe");
  });
});

describe("Graph API URL redaction", () => {
  it("strips access_token from Facebook and Instagram Graph query strings", () => {
    // Facebook/Instagram send access_token as a query param, unlike Telegram
    // (bot token in the path) or VK/X (token in the body/headers), so a
    // failed Graph call's SocialError.details.url must not leak it here.
    expect(
      redactSensitiveUrl(
        "https://graph.facebook.com/v21.0/555/feed?fields=id&access_token=EAA-secret-token&limit=10",
      ),
    ).toBe("https://graph.facebook.com/v21.0/555/feed?fields=id&access_token=[redacted]&limit=10");
    expect(
      redactSensitiveUrl("https://graph.facebook.com/v21.0/ig-1/media?access_token=EAA-secret-token"),
    ).toBe("https://graph.facebook.com/v21.0/ig-1/media?access_token=[redacted]");
  });

  it("redacts access_token wherever it appears, first, middle, or only param", () => {
    expect(redactSensitiveUrl("https://graph.facebook.com/x?access_token=abc")).toBe(
      "https://graph.facebook.com/x?access_token=[redacted]",
    );
    expect(redactSensitiveUrl("https://graph.facebook.com/x?a=1&access_token=abc&b=2")).toBe(
      "https://graph.facebook.com/x?a=1&access_token=[redacted]&b=2",
    );
  });

  it("leaves a URL with no access_token untouched", () => {
    expect(redactSensitiveUrl("https://graph.facebook.com/v21.0/555/feed?fields=id")).toBe(
      "https://graph.facebook.com/v21.0/555/feed?fields=id",
    );
  });
});
