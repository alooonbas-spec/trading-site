import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AuthenticationError,
  BotBlockedError,
  PolicyError,
  RateLimitError,
  ValidationError,
} from "@/lib/errors";
import { fetchPublicContents } from "@/lib/tinyfish/client";
import { isTinyFishConfigured, readTinyFishApiKey } from "@/lib/tinyfish/config";
import { SAFE_FETCH_PURPOSE, SAFE_SEARCH_PURPOSE, TINYFISH_ENDPOINTS } from "@/lib/tinyfish/endpoints";
import { assertAgentAutomationSafe, assertTinyFishGoalAllowed, isTinyFishGoalAllowed } from "@/lib/tinyfish/policy";
import { getSocialAdapter } from "@/social/core/registry";
import { resolveTelegramPublicProfile } from "@/social/telegram/public-profile";
import { resolveVkPublicProfile } from "@/social/vk/public-profile";
import { resolveXPublicProfile } from "@/social/x/public-profile";
import { resolveInstagramPublicProfile } from "@/social/instagram/public-profile";
import { resolveFacebookPublicProfile } from "@/social/facebook/public-profile";
import { assertProfileAvailableForLead } from "@/services/leads/collect-service";
import { TelegramAdapter } from "@/social/telegram/adapter";

function walkFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".next" || entry === ".git") {
      continue;
    }
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...walkFiles(full));
      continue;
    }
    if (full.endsWith(".ts") || full.endsWith(".tsx") || full.endsWith(".js") || full.endsWith(".mjs")) {
      files.push(full);
    }
  }
  return files;
}

describe("PHASE 5 TinyFish safety policy", () => {
  it("allows a normal public-collection purpose", () => {
    expect(isTinyFishGoalAllowed("Extract public social profile title and description")).toBe(true);
    expect(() => assertTinyFishGoalAllowed("Extract public social profile title and description")).not.toThrow();
  });

  it("rejects captcha, stealth, and rate-limit bypass language", () => {
    expect(() => assertTinyFishGoalAllowed("solve the captcha")).toThrow(PolicyError);
    expect(() => assertTinyFishGoalAllowed("bypass cloudflare bot check")).toThrow(PolicyError);
    expect(() => assertTinyFishGoalAllowed("use stealth browser profile")).toThrow(PolicyError);
    expect(() => assertTinyFishGoalAllowed("ignore 429 and keep retrying")).toThrow(PolicyError);
    expect(() => assertTinyFishGoalAllowed("rate-limit bypass for this site")).toThrow(PolicyError);
    expect(() => assertAgentAutomationSafe({ goal: "Extract title", browserProfile: "stealth" })).toThrow(
      PolicyError,
    );
    expect(() => assertAgentAutomationSafe({ goal: "Extract title", browserProfile: "lite" })).not.toThrow();
  });

  it("rejects the remaining blocked patterns not covered above", () => {
    // recaptcha/hcaptcha/turnstile are separate patterns from \bcaptcha\b:
    // \b requires a boundary before "captcha", and there is none between
    // "re" and "captcha" in "recaptcha", so a shared word would miss it.
    expect(() => assertTinyFishGoalAllowed("defeat the recaptcha widget")).toThrow(PolicyError);
    expect(() => assertTinyFishGoalAllowed("solve the hcaptcha challenge")).toThrow(PolicyError);
    expect(() => assertTinyFishGoalAllowed("get past the turnstile check")).toThrow(PolicyError);
    expect(() => assertTinyFishGoalAllowed("run in anti-detect mode")).toThrow(PolicyError);
    expect(() => assertTinyFishGoalAllowed("evade the rate limit entirely")).toThrow(PolicyError);
    expect(() => assertTinyFishGoalAllowed("captcha solving service")).toThrow(PolicyError);
    expect(() => assertTinyFishGoalAllowed("cloudflare bypass technique")).toThrow(PolicyError);
  });

  it("blocks a circumvention verb and its target in either word order, not just one", () => {
    // A prior version of this policy only matched "rate limit ... circumvent"
    // and "evade ... rate limit", so rephrasing to put the verb first ("evade")
    // or the target first ("rate limit circumvent") could slip past. Both
    // directions must be blocked for every verb/target pair, not just some.
    expect(() => assertTinyFishGoalAllowed("circumvent the rate limit")).toThrow(PolicyError);
    expect(() => assertTinyFishGoalAllowed("rate limit circumvention")).toThrow(PolicyError);
    expect(() => assertTinyFishGoalAllowed("disable the rate limit")).toThrow(PolicyError);
    expect(() => assertTinyFishGoalAllowed("rate limit disable")).toThrow(PolicyError);
    expect(() => assertTinyFishGoalAllowed("rate limit evasion tactics")).toThrow(PolicyError);
    expect(() => assertTinyFishGoalAllowed("429 ignore and retry immediately")).toThrow(PolicyError);
  });

  it("rejects a blank goal instead of treating it as harmless", () => {
    expect(isTinyFishGoalAllowed("")).toBe(false);
    expect(isTinyFishGoalAllowed("   ")).toBe(false);
    expect(() => assertTinyFishGoalAllowed("")).toThrow(PolicyError);
  });

  it("does not over-block a legitimate goal that merely mentions rate limits with no bypass language", () => {
    expect(isTinyFishGoalAllowed("Check the current rate limit status for this account")).toBe(true);
    expect(isTinyFishGoalAllowed("Summarize the profile bio and pinned post")).toBe(true);
  });

  it("still blocks any mention of captcha at all, even without explicit solve/bypass language", () => {
    expect(isTinyFishGoalAllowed("List the captcha vendor named on the support page")).toBe(false);
  });

  it("never blocks its own default fetch/search purposes (a policy regression guard)", () => {
    expect(isTinyFishGoalAllowed(SAFE_FETCH_PURPOSE)).toBe(true);
    expect(isTinyFishGoalAllowed(SAFE_SEARCH_PURPOSE)).toBe(true);
  });
});

describe("TinyFish API key configuration", () => {
  afterEach(() => {
    delete process.env.TINYFISH_API_KEY;
  });

  it("reports configured only when TINYFISH_API_KEY is set to something non-blank", () => {
    delete process.env.TINYFISH_API_KEY;
    expect(isTinyFishConfigured()).toBe(false);
    process.env.TINYFISH_API_KEY = "   ";
    expect(isTinyFishConfigured()).toBe(false);
    process.env.TINYFISH_API_KEY = "tf-secret-key";
    expect(isTinyFishConfigured()).toBe(true);
  });

  it("fails honestly instead of sending an empty X-API-Key when unconfigured", () => {
    delete process.env.TINYFISH_API_KEY;
    expect(() => readTinyFishApiKey()).toThrow(ValidationError);
    process.env.TINYFISH_API_KEY = " tf-secret-key ";
    expect(readTinyFishApiKey()).toBe("tf-secret-key");
  });
});

describe("official public profile URLs", () => {
  it("builds official Telegram, VK, X, Instagram, and Facebook profile URLs", () => {
    expect(resolveTelegramPublicProfile("@durov")).toEqual({
      profileUrl: "https://t.me/durov",
      externalProfileId: "durov",
      username: "@durov",
    });
    expect(resolveTelegramPublicProfile("https://t.me/durov")).toEqual({
      profileUrl: "https://t.me/durov",
      externalProfileId: "durov",
      username: "@durov",
    });
    expect(resolveVkPublicProfile("id1")).toEqual({
      profileUrl: "https://vk.com/1",
      externalProfileId: "1",
      username: "1",
    });
    expect(resolveVkPublicProfile("https://vk.ru/durov")).toEqual({
      profileUrl: "https://vk.com/durov",
      externalProfileId: "durov",
      username: "durov",
    });
    expect(resolveXPublicProfile("https://twitter.com/jack")).toEqual({
      profileUrl: "https://x.com/jack",
      externalProfileId: "jack",
      username: "@jack",
    });
    expect(resolveInstagramPublicProfile("cristiano")).toEqual({
      profileUrl: "https://www.instagram.com/cristiano/",
      externalProfileId: "cristiano",
      username: "@cristiano",
    });
    expect(resolveFacebookPublicProfile("https://www.facebook.com/profile.php?id=4")).toEqual({
      profileUrl: "https://www.facebook.com/4",
      externalProfileId: "4",
      username: null,
    });
  });

  it("rejects non-official hosts and non-profile paths", () => {
    expect(() => resolveTelegramPublicProfile("https://evil.example/durov")).toThrow(ValidationError);
    expect(() => resolveTelegramPublicProfile("https://t.me/joinchat/AAAA")).toThrow(ValidationError);
    expect(() => resolveVkPublicProfile("https://vk.com/im")).toThrow(ValidationError);
    expect(() => resolveXPublicProfile("https://x.com/jack/status/1")).toThrow(ValidationError);
    expect(() => resolveInstagramPublicProfile("https://www.instagram.com/p/shortcode/")).toThrow(ValidationError);
    expect(() => resolveFacebookPublicProfile("https://www.facebook.com/groups/123")).toThrow(ValidationError);
  });

  it("rejects Facebook pages/ and people/ permalinks instead of misreading the reserved path segment as a username", () => {
    // facebook.com/pages/<name>/<id> and facebook.com/people/<name>/<id> are
    // Facebook's own permalink formats, not usernames -- without an explicit
    // reject, firstPathSegment would return "pages"/"people" and the code
    // would treat that reserved word itself as a valid handle.
    expect(() => resolveFacebookPublicProfile("https://www.facebook.com/pages/Some-Page/123456789012345")).toThrow(
      ValidationError,
    );
    expect(() => resolveFacebookPublicProfile("https://www.facebook.com/people/John-Doe/100012345678901")).toThrow(
      ValidationError,
    );
  });

  it("rejects VK wall/photo/video/etc. content permalinks instead of misreading them as a screen name", () => {
    // vk.com/wall<ownerId>_<postId> (and the same pattern for photo, video,
    // board, market, album, docs, audio, clip) is a content permalink, not a
    // screen name -- REJECTED_VK_PATHS only matches the bare reserved word,
    // so the combined "wall123_456" segment previously passed VK_SCREEN_NAME
    // untouched and was treated as if it were a real screen name.
    expect(() => resolveVkPublicProfile("https://vk.com/wall123_456")).toThrow(ValidationError);
    expect(() => resolveVkPublicProfile("https://vk.com/wall-123_456")).toThrow(ValidationError);
    expect(() => resolveVkPublicProfile("https://vk.com/photo123_456")).toThrow(ValidationError);
    expect(() => resolveVkPublicProfile("https://vk.com/video123_456")).toThrow(ValidationError);
    // A real screen name that merely starts with one of those words but
    // isn't the full permalink shape must still resolve normally.
    expect(resolveVkPublicProfile("https://vk.com/wallpaper_studio")).toEqual({
      profileUrl: "https://vk.com/wallpaper_studio",
      externalProfileId: "wallpaper_studio",
      username: "wallpaper_studio",
    });
  });
});

describe("TinyFish Fetch client", () => {
  afterEach(() => {
    delete process.env.TINYFISH_API_KEY;
    vi.unstubAllGlobals();
  });

  it("posts to the official Fetch endpoint with X-API-Key and no stealth profile", async () => {
    process.env.TINYFISH_API_KEY = "test-key";
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(_url).toBe(TINYFISH_ENDPOINTS.fetch);
      const headers = new Headers(init?.headers);
      expect(headers.get("X-API-Key")).toBe("test-key");
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      expect(body.urls).toEqual(["https://t.me/durov"]);
      expect(body).not.toHaveProperty("browser_profile");
      expect(JSON.stringify(body)).not.toMatch(/stealth/i);
      return new Response(
        JSON.stringify({
          results: [
            {
              url: "https://t.me/durov",
              final_url: "https://t.me/durov",
              title: "Durov",
              description: "Public bio",
              text: "# Durov",
            },
          ],
          errors: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchPublicContents(["https://t.me/durov"]);
    expect(result.results[0]?.title).toBe("Durov");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps HTTP 401 to AuthenticationError", async () => {
    process.env.TINYFISH_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: { code: "INVALID_API_KEY", message: "Invalid or expired API key" } }), { status: 401 })),
    );
    await expect(fetchPublicContents(["https://t.me/durov"])).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("maps HTTP 429 to RateLimitError and does not retry", async () => {
    process.env.TINYFISH_API_KEY = "test-key";
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: "RATE_LIMIT_EXCEEDED", message: "Rate limit exceeded" } }), {
          status: 429,
          headers: { "Retry-After": "12" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const error = await fetchPublicContents(["https://t.me/durov"]).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).details?.retryAfter).toBe(12);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails bot_blocked without a stealth retry", async () => {
    process.env.TINYFISH_API_KEY = "test-key";
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            results: [],
            errors: [{ url: "https://t.me/durov", error: "bot_blocked" }],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new TelegramAdapter().collectPublicData({ workspaceId: "w", source: "durov" }),
    ).rejects.toBeInstanceOf(BotBlockedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    expect(body).not.toHaveProperty("browser_profile");
  });

  it("collects a public Telegram profile through the adapter", async () => {
    process.env.TINYFISH_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              results: [
                {
                  url: "https://t.me/durov",
                  final_url: "https://t.me/durov",
                  title: "Pavel Durov",
                  description: "Telegram",
                  text: "Public page",
                },
              ],
              errors: [],
            }),
            { status: 200 },
          ),
      ),
    );

    const collected = await getSocialAdapter("telegram").collectPublicData({
      workspaceId: "w",
      source: "durov",
    });
    expect(collected.profiles).toHaveLength(1);
    expect(collected.profiles[0]?.profileUrl).toBe("https://t.me/durov");
    expect(collected.profiles[0]?.displayName).toBe("Pavel Durov");
    expect(collected.profiles[0]?.externalProfileId).toBe("durov");
  });
});

describe("collected profile ownership", () => {
  it("does not steal a unique profile from another lead", () => {
    expect(() => assertProfileAvailableForLead("lead-a", "lead-b")).toThrow(ValidationError);
    expect(() => assertProfileAvailableForLead("lead-a", "lead-a")).not.toThrow();
    expect(() => assertProfileAvailableForLead(null, "lead-a")).not.toThrow();
  });
});

describe("PHASE 5 source boundaries", () => {
  it("keeps TinyFish server-only and never exposes NEXT_PUBLIC_TINYFISH", () => {
    const files = ["app", "components", "lib", "services", "social", "config"].flatMap(walkFiles);
    const clientFiles = files.filter((file) => {
      const content = readFileSync(file, "utf8");
      return /["']use client["']/.test(content);
    });

    for (const file of files) {
      const content = readFileSync(file, "utf8");
      if (/NEXT_PUBLIC_TINYFISH/.test(content)) {
        throw new Error(`${file} must not expose NEXT_PUBLIC_TINYFISH`);
      }
    }

    for (const file of clientFiles) {
      const content = readFileSync(file, "utf8");
      if (/TINYFISH_API_KEY/.test(content)) {
        throw new Error(`${file} must not include TINYFISH_API_KEY`);
      }
      if (/@\/lib\/tinyfish|lib\/tinyfish/.test(content)) {
        throw new Error(`${file} must not import TinyFish`);
      }
      if (/browser_profile\s*:\s*["']stealth["']/.test(content)) {
        throw new Error(`${file} must not send stealth browser profiles`);
      }
    }

    const clientSource = readFileSync("lib/tinyfish/client.ts", "utf8");
    const endpointsSource = readFileSync("lib/tinyfish/endpoints.ts", "utf8");
    expect(clientSource).toContain("TINYFISH_ENDPOINTS.fetch");
    expect(clientSource).toContain("X-API-Key");
    expect(clientSource).not.toMatch(/browser_profile/);
    expect(clientSource).not.toMatch(/stealth/);
    expect(endpointsSource).toContain("https://api.fetch.tinyfish.ai");
    expect(endpointsSource).toContain("https://api.search.tinyfish.ai");
    expect(endpointsSource).toContain("https://agent.tinyfish.ai/v1/automation/run");

    const collectService = readFileSync("services/leads/collect-service.ts", "utf8");
    expect(collectService).not.toMatch(/platform\s*===\s*["']telegram["']/);
    expect(collectService).not.toMatch(/if\s*\(\s*platform\s*===/);
  });

  it("adds PROFILE_COLLECTED without creating a do_not_contact column", () => {
    const sql = readFileSync("supabase/migrations/20260821180000_phase5_tinyfish.sql", "utf8");
    expect(sql).toContain("PROFILE_COLLECTED");
    expect(sql).not.toMatch(/do_not_contact boolean/);
  });
});
