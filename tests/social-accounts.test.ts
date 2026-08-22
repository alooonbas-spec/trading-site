import { afterEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { AuthenticationError, ValidationError } from "@/lib/errors";
import { deriveTokenStatus, isAccountOperable } from "@/lib/social/account-health";
import { filterSocialAccounts } from "@/lib/social/filter-accounts";
import { createOAuthState, createPkcePair, isOAuthStateExpired } from "@/lib/social/pkce";
import { oauthCallbackPath } from "@/lib/social/app-origin";
import { isPublishDestinationKey, PUBLISH_DESTINATION_KEYS } from "@/lib/social/publish-destination";
import {
  assertNoTokenLeak,
  encryptConnectResult,
  toPublicSocialAccount,
} from "@/services/social-accounts/mapper";
import type { SocialAccountPublic } from "@/types/social-account";

function account(overrides: Partial<SocialAccountPublic> = {}): SocialAccountPublic {
  return {
    id: "acc-1",
    workspaceId: "ws-1",
    platform: "telegram",
    externalAccountId: "42",
    username: "@hub_bot",
    displayName: "Hub",
    avatarUrl: null,
    status: "CONNECTED",
    scopes: ["bot"],
    tokenExpiresAt: null,
    lastSyncAt: null,
    lastError: null,
    lastErrorAt: null,
    createdAt: "2026-08-21T00:00:00.000Z",
    updatedAt: "2026-08-21T00:00:00.000Z",
    ...overrides,
  };
}

describe("encryptConnectResult", () => {
  afterEach(() => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
  });

  it("encrypts access and refresh tokens, and keeps a null refresh token null", () => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("hex");
    const encrypted = encryptConnectResult({
      externalAccountId: "42",
      username: null,
      displayName: null,
      avatarUrl: null,
      scopes: [],
      accessToken: "access-token-value",
      refreshToken: "refresh-token-value",
      tokenExpiresAt: null,
    });
    expect(encrypted.access_token_encrypted.startsWith("v1:")).toBe(true);
    expect(encrypted.access_token_encrypted).not.toContain("access-token-value");
    expect(encrypted.refresh_token_encrypted?.startsWith("v1:")).toBe(true);

    const withoutRefresh = encryptConnectResult({
      externalAccountId: "42",
      username: null,
      displayName: null,
      avatarUrl: null,
      scopes: [],
      accessToken: "access-token-value",
      refreshToken: null,
      tokenExpiresAt: null,
    });
    expect(withoutRefresh.refresh_token_encrypted).toBeNull();
  });

  it("fails honestly when TOKEN_ENCRYPTION_KEY is not configured", () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() =>
      encryptConnectResult({
        externalAccountId: "42",
        username: null,
        displayName: null,
        avatarUrl: null,
        scopes: [],
        accessToken: "access-token-value",
        refreshToken: null,
        tokenExpiresAt: null,
      }),
    ).toThrow(ValidationError);
  });
});

describe("PKCE", () => {
  it("creates a state of at least 32 characters and an S256 challenge", () => {
    const state = createOAuthState();
    const pkce = createPkcePair();
    expect(state.length).toBeGreaterThanOrEqual(32);
    expect(pkce.verifier.length).toBeGreaterThanOrEqual(32);
    expect(pkce.challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(pkce.challenge).not.toBe(pkce.verifier);
  });

  it("expires an OAuth state exactly at its expiry, not a moment before", () => {
    const now = new Date("2026-08-21T12:10:00.000Z");
    expect(isOAuthStateExpired("2026-08-21T12:09:59.999Z", now)).toBe(true);
    expect(isOAuthStateExpired("2026-08-21T12:10:00.000Z", now)).toBe(true);
    expect(isOAuthStateExpired("2026-08-21T12:10:00.001Z", now)).toBe(false);
  });
});

describe("oauthCallbackPath", () => {
  it("builds the registered per-platform redirect path README documents", () => {
    expect(oauthCallbackPath("vk")).toBe("/api/social/vk/callback");
    expect(oauthCallbackPath("x")).toBe("/api/social/x/callback");
    expect(oauthCallbackPath("facebook")).toBe("/api/social/facebook/callback");
    expect(oauthCallbackPath("instagram")).toBe("/api/social/instagram/callback");
  });
});

describe("publish destination allowlist", () => {
  it("only allows the documented metadata keys used to target a publish destination", () => {
    for (const key of PUBLISH_DESTINATION_KEYS) {
      expect(isPublishDestinationKey(key)).toBe(true);
    }
    expect(isPublishDestinationKey("accessToken")).toBe(false);
    expect(isPublishDestinationKey("refreshToken")).toBe(false);
    expect(isPublishDestinationKey("__proto__")).toBe(false);
  });
});

describe("account health", () => {
  it("treats only CONNECTED accounts with a live token as operable", () => {
    expect(isAccountOperable("CONNECTED")).toBe(true);
    expect(isAccountOperable("DISCONNECTED")).toBe(false);
    expect(isAccountOperable("REAUTH_REQUIRED")).toBe(false);
    expect(deriveTokenStatus({ status: "CONNECTED", tokenExpiresAt: null })).toBe("CONNECTED");
    expect(
      deriveTokenStatus({
        status: "CONNECTED",
        tokenExpiresAt: "2020-01-01T00:00:00.000Z",
        now: new Date("2026-08-21T00:00:00.000Z"),
      }),
    ).toBe("EXPIRED");
    expect(deriveTokenStatus({ status: "DISCONNECTED", tokenExpiresAt: null })).toBe("MISSING");
  });
});

describe("account selector filters", () => {
  it("filters by platform, status, group, and search query", () => {
    const accounts = [
      account(),
      account({
        id: "acc-2",
        platform: "vk",
        username: "brand",
        externalAccountId: "99",
        status: "ERROR",
      }),
    ];

    expect(filterSocialAccounts(accounts, { platforms: ["telegram"] })).toHaveLength(1);
    expect(filterSocialAccounts(accounts, { statuses: ["ERROR"] })[0]?.id).toBe("acc-2");
    expect(filterSocialAccounts(accounts, { groupAccountIds: ["acc-2"] })).toHaveLength(1);
    expect(filterSocialAccounts(accounts, { query: "brand" })[0]?.platform).toBe("vk");
  });
});

describe("public social account mapper", () => {
  it("never includes encrypted token columns", () => {
    const mapped = toPublicSocialAccount({
      id: "acc-1",
      workspace_id: "ws-1",
      platform: "telegram",
      external_account_id: "42",
      username: "@hub_bot",
      display_name: "Hub",
      avatar_url: null,
      status: "CONNECTED",
      scopes: ["bot"],
      token_expires_at: null,
      last_sync_at: null,
      last_error: null,
      last_error_at: null,
      created_at: "2026-08-21T00:00:00.000Z",
      updated_at: "2026-08-21T00:00:00.000Z",
    });

    expect(mapped).not.toHaveProperty("access_token_encrypted");
    expect(mapped).not.toHaveProperty("refresh_token_encrypted");
    expect(() =>
      assertNoTokenLeak({
        id: "acc-1",
        access_token_encrypted: "secret",
      }),
    ).toThrow(AuthenticationError);
  });
});
