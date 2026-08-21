import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UnsupportedActionError, ValidationError } from "@/lib/errors";
import { getSocialAdapter } from "@/social/core/registry";
import { VkAdapter } from "@/social/vk/adapter";
import { vkMethodUrl } from "@/social/vk/api";
import {
  buildVkNewsfeedSearchQuery,
  parseVkNewsfeedSearch,
  vkNewsfeedSearchCursor,
} from "@/social/vk/monitor";

describe("PHASE 19 VK newsfeed.search", () => {
  afterEach(() => {
    delete process.env.TINYFISH_API_KEY;
    delete process.env.VK_SERVICE_TOKEN;
    vi.unstubAllGlobals();
  });

  it("builds an official OR query and reads unix start_time cursors", () => {
    expect(buildVkNewsfeedSearchQuery(["social hub", "launch"])).toBe('"social hub" | "launch"');
    expect(() => buildVkNewsfeedSearchQuery(["  "])).toThrow(ValidationError);
    expect(vkNewsfeedSearchCursor("1710000000")).toBe("1710000000");
    expect(vkNewsfeedSearchCursor("tweet-1")).toBeUndefined();
    expect(vkNewsfeedSearchCursor("123")).toBeUndefined();
  });

  it("parses wall posts, skips unmatched or empty text, and advances the date cursor", () => {
    const parsed = parseVkNewsfeedSearch(
      {
        items: [
          { id: 1, owner_id: 10, from_id: 10, date: 1710000001, text: "Hello social hub" },
          { id: 2, owner_id: 11, from_id: 11, date: 1710000099, text: "unrelated" },
          { id: 3, owner_id: -20, from_id: -20, date: 1710000002, text: "   " },
        ],
        profiles: [{ id: 10, screen_name: "lead", first_name: "Lead" }],
        groups: [{ id: 20, screen_name: "hubgroup", name: "Hub" }],
      },
      ["social hub"],
    );
    expect(parsed.cursor).toBe("1710000099");
    expect(parsed.events).toEqual([
      {
        externalId: "10_1",
        author: "@lead",
        content: "Hello social hub",
        url: "https://vk.com/wall10_1",
        matchedKeywords: ["social hub"],
      },
    ]);
  });

  it("searches through official newsfeed.search with a user token", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe(vkMethodUrl("newsfeed.search"));
      expect(String(init?.body)).toContain("q=%22social+hub%22");
      expect(String(init?.body)).toContain("extended=1");
      expect(String(init?.body)).toContain("start_time=1710000000");
      expect(String(init?.body)).toContain("access_token=vk-token");
      return new Response(
        JSON.stringify({
          response: {
            items: [
              { id: 9, owner_id: 42, from_id: 42, date: 1710000042, text: "Hello social hub" },
            ],
            profiles: [{ id: 42, first_name: "Anna", last_name: "Lead" }],
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new VkAdapter({ accessToken: "vk-token" }).monitor({
      workspaceId: "w",
      socialAccountId: "a",
      keywords: ["social hub"],
      sources: [],
      cursor: "1710000000",
    });
    expect(result.cursor).toBe("1710000042");
    expect(result.events[0]).toMatchObject({
      externalId: "42_9",
      author: "Anna Lead",
      url: "https://vk.com/wall42_9",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses VK_SERVICE_TOKEN when the adapter has no user token", async () => {
    process.env.VK_SERVICE_TOKEN = "service-token";
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe(vkMethodUrl("newsfeed.search"));
      expect(String(init?.body)).toContain("access_token=service-token");
      return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new VkAdapter().monitor({
      workspaceId: "w",
      socialAccountId: null,
      keywords: ["social"],
      sources: ["https://vk.com/feed"],
    });
    expect(result.events).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails tokenless VK monitoring honestly without a service token or TinyFish", async () => {
    await expect(
      new VkAdapter().monitor({
        workspaceId: "w",
        socialAccountId: null,
        keywords: ["hello"],
        sources: [],
      }),
    ).rejects.toBeInstanceOf(UnsupportedActionError);
  });

  it("keeps Meta monitoring on TinyFish and does not switch in the worker", async () => {
    expect((await getSocialAdapter("vk").getCapabilities()).monitoring).toBe(true);
    expect((await getSocialAdapter("facebook").getCapabilities()).monitoring).toBe(false);
    expect((await getSocialAdapter("instagram").getCapabilities()).monitoring).toBe(false);
    const worker = readFileSync("services/jobs/worker-service.ts", "utf8");
    expect(worker).not.toMatch(/if\s*\(\s*platform\s*===/);
    expect(worker).toContain("adapter.monitor");
    expect(readFileSync("social/vk/monitor.ts", "utf8")).toContain("newsfeed.search");
  });
});
