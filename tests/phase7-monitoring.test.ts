import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RateLimitError,
  UnsupportedActionError,
  ValidationError,
} from "@/lib/errors";
import { matchKeywords, parseKeywordList } from "@/lib/monitoring/keywords";
import {
  canDisableMonitoringRule,
  canPauseMonitoringRule,
  canResumeMonitoringRule,
  canRunMonitoringRule,
} from "@/lib/monitoring/status";
import { searchPublicContents } from "@/lib/tinyfish/client";
import { TINYFISH_ENDPOINTS } from "@/lib/tinyfish/endpoints";
import { createMonitoringRuleSchema } from "@/lib/validation/monitoring";
import { assertMonitorSourcesAllowed } from "@/social/core/monitor-sources";
import { getSocialAdapter } from "@/social/core/registry";
import { TelegramAdapter } from "@/social/telegram/adapter";
import { XAdapter, buildXRecentSearchQuery } from "@/social/x/adapter";
import { MONITORING_RULE_STATUSES } from "@/types/status";
import { JOB_TYPES } from "@/types/campaign";

describe("monitoring rule status machine", () => {
  it("stays independent from lead, contact, and job statuses", () => {
    expect(MONITORING_RULE_STATUSES).toEqual(["ACTIVE", "PAUSED", "DISABLED"]);
    expect(MONITORING_RULE_STATUSES).not.toContain("DO_NOT_CONTACT");
    expect(MONITORING_RULE_STATUSES).not.toContain("SUCCESS");
    expect(MONITORING_RULE_STATUSES).not.toContain("MESSAGE_SENT");
    expect(canRunMonitoringRule("ACTIVE")).toBe(true);
    expect(canPauseMonitoringRule("ACTIVE")).toBe(true);
    expect(canResumeMonitoringRule("PAUSED")).toBe(true);
    expect(canDisableMonitoringRule("DISABLED")).toBe(false);
  });
});

describe("keyword matching and validation", () => {
  it("matches keywords case-insensitively and ignores blanks", () => {
    expect(matchKeywords("Hello from Social Hub", ["social", "missing"])).toEqual(["social"]);
    expect(parseKeywordList("alpha\n beta,ALPHA ")).toEqual(["alpha", "beta"]);
    expect(createMonitoringRuleSchema.safeParse({
      name: "Mentions",
      keywords: ["social"],
      sources: [],
      platform: "x",
      socialAccountId: null,
    }).success).toBe(true);
    expect(createMonitoringRuleSchema.safeParse({
      name: "Mentions",
      keywords: [],
      sources: [],
      platform: "x",
      socialAccountId: null,
    }).success).toBe(false);
  });
});

describe("official monitor sources", () => {
  it("rejects non-official hosts", () => {
    expect(() => assertMonitorSourcesAllowed("x", ["https://x.com/jack"])).not.toThrow();
    expect(() => assertMonitorSourcesAllowed("telegram", ["https://t.me/durov"])).not.toThrow();
    expect(() => assertMonitorSourcesAllowed("x", ["https://evil.example/jack"])).toThrow(ValidationError);
    expect(() => assertMonitorSourcesAllowed("vk", ["https://example.com"])).toThrow(ValidationError);
  });
});

describe("monitoring adapters", () => {
  afterEach(() => {
    delete process.env.TINYFISH_API_KEY;
    vi.unstubAllGlobals();
  });

  it("enables X, Telegram, and VK monitoring without TinyFish and keeps Meta on TinyFish", async () => {
    expect((await getSocialAdapter("x").getCapabilities()).monitoring).toBe(true);
    expect((await getSocialAdapter("telegram").getCapabilities()).monitoring).toBe(true);
    expect((await getSocialAdapter("vk").getCapabilities()).monitoring).toBe(true);
    expect((await getSocialAdapter("facebook").getCapabilities()).monitoring).toBe(false);
    expect((await getSocialAdapter("instagram").getCapabilities()).monitoring).toBe(false);
    await expect(
      getSocialAdapter("vk").monitor({
        workspaceId: "w",
        socialAccountId: null,
        keywords: ["hello"],
        sources: [],
      }),
    ).rejects.toBeInstanceOf(UnsupportedActionError);
  });

  it("enables TinyFish monitoring for remaining platforms when the key is set", async () => {
    process.env.TINYFISH_API_KEY = "test-key";
    expect((await getSocialAdapter("vk").getCapabilities()).monitoring).toBe(true);
    expect((await getSocialAdapter("vk").getCapabilities()).contactActions).toBe(false);
  });

  it("fails tokenless Telegram monitoring honestly without TinyFish", async () => {
    await expect(
      new TelegramAdapter().monitor({
        workspaceId: "w",
        socialAccountId: null,
        keywords: ["hello"],
        sources: [],
      }),
    ).rejects.toBeInstanceOf(UnsupportedActionError);
  });

  it("searches X through the official recent search endpoint and filters keywords", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(String(url)).toContain("https://api.x.com/2/tweets/search/recent");
      expect(String(url)).toContain("query=");
      expect(buildXRecentSearchQuery(["social hub"])).toBe('"social hub"');
      return new Response(
        JSON.stringify({
          data: [
            { id: "1", text: "Hello social hub", author_id: "u1" },
            { id: "2", text: "unrelated", author_id: "u1" },
          ],
          includes: { users: [{ id: "u1", username: "jack", name: "Jack" }] },
          meta: { newest_id: "2", result_count: 2 },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new XAdapter({ accessToken: "x-token" }).monitor({
      workspaceId: "w",
      socialAccountId: "a",
      keywords: ["social hub"],
      sources: [],
    });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.externalId).toBe("1");
    expect(result.events[0]?.author).toBe("@jack");
    expect(result.cursor).toBe("pages:done|tweets:2");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("filters Telegram getUpdates by keywords and advances the cursor", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(String(url)).toContain("https://api.telegram.org/bot");
      expect(String(url)).toContain("/getUpdates");
      return new Response(
        JSON.stringify({
          ok: true,
          result: [
            {
              update_id: 10,
              message: {
                message_id: 1,
                text: "Hello social hub",
                from: { username: "alice" },
                chat: { id: 1, username: "alice" },
              },
            },
            {
              update_id: 11,
              message: {
                message_id: 2,
                text: "weather update",
                from: { username: "bob" },
                chat: { id: 2, username: "bob" },
              },
            },
          ],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new TelegramAdapter({ accessToken: "123456:ABC-token_value" }).monitor({
      workspaceId: "w",
      socialAccountId: "a",
      keywords: ["social"],
      sources: [],
    });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.externalId).toBe("10");
    expect(result.events[0]?.matchedKeywords).toEqual(["social"]);
    expect(result.cursor).toBe("12");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("TinyFish Search client", () => {
  afterEach(() => {
    delete process.env.TINYFISH_API_KEY;
    vi.unstubAllGlobals();
  });

  it("calls the official Search endpoint with X-API-Key and no stealth profile", async () => {
    process.env.TINYFISH_API_KEY = "test-key";
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url).startsWith(TINYFISH_ENDPOINTS.search)).toBe(true);
      expect(String(url)).toContain("include_domains=x.com");
      const headers = new Headers(init?.headers);
      expect(headers.get("X-API-Key")).toBe("test-key");
      expect(String(url)).not.toMatch(/stealth/i);
      return new Response(
        JSON.stringify({
          query: "social",
          results: [
            {
              title: "A social post",
              snippet: "Hello social hub",
              url: "https://x.com/jack/status/1",
              domain: "x.com",
            },
            {
              title: "Unrelated",
              snippet: "weather",
              url: "https://x.com/jack/status/2",
              domain: "x.com",
            },
          ],
          total_results: 2,
          page: 1,
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const searched = await searchPublicContents({
      query: "social",
      includeDomains: ["x.com", "twitter.com"],
    });
    expect(searched.results).toHaveLength(2);

    const collected = await getSocialAdapter("x").monitor({
      workspaceId: "w",
      socialAccountId: null,
      keywords: ["social"],
      sources: [],
    });
    expect(collected.events).toHaveLength(1);
    expect(collected.events[0]?.url).toBe("https://x.com/jack/status/1");
  });

  it("maps HTTP 429 to RateLimitError and does not retry", async () => {
    process.env.TINYFISH_API_KEY = "test-key";
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: "RATE_LIMIT_EXCEEDED", message: "Rate limit exceeded" } }), {
          status: 429,
          headers: { "Retry-After": "9" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const error = await searchPublicContents({
      query: "social",
      includeDomains: ["x.com"],
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).details?.retryAfter).toBe(9);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("PHASE 7 source boundaries", () => {
  it("does not add do_not_contact to monitoring tables and unique-keys events", () => {
    const sql = readFileSync("supabase/migrations/20260821220000_phase7_monitoring.sql", "utf8");
    const withoutComments = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(withoutComments).not.toMatch(/do_not_contact boolean/);
    expect(sql).toContain("unique (workspace_id, rule_id, external_id)");
    expect(sql).toContain("type = 'MONITOR'");
    expect(sql).toContain("alter column social_account_id drop not null");
    expect(sql).toContain("r.status = 'ACTIVE'");
    expect(sql).toContain("for update of j skip locked");
    expect(JOB_TYPES).toContain("MONITOR");
  });

  it("keeps platform switches out of the monitoring worker", () => {
    const worker = readFileSync("services/jobs/worker-service.ts", "utf8");
    expect(worker).not.toMatch(/platform\s*===\s*["']telegram["']/);
    expect(worker).not.toMatch(/if\s*\(\s*platform\s*===/);
    expect(worker).toContain('job.type === "MONITOR"');
    expect(worker).toContain("adapter.monitor");
    expect(worker).toContain("capabilities.monitoring");
  });
});
