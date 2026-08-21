import { afterEach, describe, expect, it, vi } from "vitest";
import { VkAdapter } from "@/social/vk/adapter";
import { vkMethodUrl } from "@/social/vk/api";
import {
  encodeVkSearchFrom,
  nextVkSearchPageCursor,
  vkNewsfeedSearchCursor,
} from "@/social/vk/monitor";

describe("VK newsfeed.search start_from helpers", () => {
  it("reads named time watermarks and stays done once stored", () => {
    expect(vkNewsfeedSearchCursor("pages:done|time:1710000000")).toBe("1710000000");
    expect(
      nextVkSearchPageCursor({
        firstPageFrom: "30/abc",
        olderPageFrom: null,
        fetchedOlder: false,
      }),
    ).toBe(encodeVkSearchFrom("30/abc"));
    expect(
      nextVkSearchPageCursor({
        stored: "done",
        firstPageFrom: "30/abc",
        olderPageFrom: "60/def",
        fetchedOlder: false,
      }),
    ).toBe("done");
  });
});

describe("PHASE 47 VK newsfeed.search start_from", () => {
  afterEach(() => {
    delete process.env.TINYFISH_API_KEY;
    delete process.env.VK_SERVICE_TOKEN;
    vi.unstubAllGlobals();
  });

  it("walks the next official start_from window and keeps older matching posts", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe(vkMethodUrl("newsfeed.search"));
      const body = String(init?.body);
      expect(body).toContain("q=%22social+hub%22");
      expect(body).toContain("extended=1");
      expect(body).toContain("count=30");
      if (new URLSearchParams(body).get("start_from")) {
        expect(new URLSearchParams(body).get("start_from")).toBe("30/abc");
        return new Response(
          JSON.stringify({
            response: {
              items: [
                { id: 1, owner_id: 10, from_id: 10, date: 1710000001, text: "older social hub" },
              ],
              profiles: [{ id: 10, screen_name: "lead" }],
            },
          }),
          { status: 200 },
        );
      }
      expect(body).not.toContain("start_from=");
      return new Response(
        JSON.stringify({
          response: {
            items: [
              { id: 9, owner_id: 10, from_id: 10, date: 1710000099, text: "newer social hub" },
            ],
            profiles: [{ id: 10, screen_name: "lead" }],
            next_from: "30/abc",
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await new VkAdapter({ accessToken: "vk-token" }).monitor({
      workspaceId: "w",
      socialAccountId: "a",
      keywords: ["social hub"],
      sources: [],
    });
    expect(first.events.map((item) => item.externalId)).toEqual(["10_9"]);
    expect(first.cursor).toBe(`pages:${encodeVkSearchFrom("30/abc")}|time:1710000099`);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const second = await new VkAdapter({ accessToken: "vk-token" }).monitor({
      workspaceId: "w",
      socialAccountId: "a",
      keywords: ["social hub"],
      sources: [],
      cursor: first.cursor,
    });
    expect(second.events.map((item) => item.externalId)).toEqual(["10_9", "10_1"]);
    expect(second.cursor).toBe("pages:done|time:1710000099");
    expect(fetchMock.mock.calls.filter(([, init]) => String(init?.body).includes("start_from="))).toHaveLength(1);
  });

  it("skips start_from once pages:done is stored", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe(vkMethodUrl("newsfeed.search"));
      const body = String(init?.body);
      if (body.includes("start_from=")) {
        throw new Error(`unexpected start_from ${body}`);
      }
      expect(body).toContain("start_time=1710000000");
      return new Response(
        JSON.stringify({
          response: {
            items: [
              { id: 9, owner_id: 42, from_id: 42, date: 1710000042, text: "Hello social hub" },
            ],
            next_from: "30/abc",
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
      cursor: "pages:done|time:1710000000",
    });
    expect(result.events.map((item) => item.externalId)).toEqual(["42_9"]);
    expect(result.cursor).toBe("pages:done|time:1710000042");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
