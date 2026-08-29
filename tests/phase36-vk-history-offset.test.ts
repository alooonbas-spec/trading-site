import { afterEach, describe, expect, it, vi } from "vitest";
import { VkAdapter } from "@/social/vk/adapter";
import { vkMethodUrl } from "@/social/vk/api";
import { vkCommunityMetadata } from "@/social/vk/community";
import { parseVkInboxCursor } from "@/social/vk/inbox";

const communityMetadata = vkCommunityMetadata("12345");

function historyItems(startId: number, count: number): Array<{
  id: number;
  from_id: number;
  text: string;
  date: number;
  out: number;
  peer_id: number;
}> {
  return Array.from({ length: count }, (_, index) => {
    const id = startId - index;
    return {
      id,
      from_id: 42,
      text: `msg ${id}`,
      date: 1710000000 + id,
      out: 0,
      peer_id: 42,
    };
  });
}

describe("VK community history offset cursor", () => {
  it("parses history pages and the done marker", () => {
    expect(parseVkInboxCursor("comments:1|history:2|messages:8")).toEqual({
      comments: "1",
      messages: "8",
      history: true,
      historyPage: 2,
      conversations: false,
      conversationsPage: 0,
      wall: false,
      wallPage: 0,
      wallcomments: false,
      wallcommentsPage: 0,
    });
    expect(parseVkInboxCursor("comments:1|history:done|messages:8")).toEqual({
      comments: "1",
      messages: "8",
      history: true,
      historyPage: "done",
      conversations: false,
      conversationsPage: 0,
      wall: false,
      wallPage: 0,
      wallcomments: false,
      wallcommentsPage: 0,
    });
  });
});

describe("PHASE 36 VK community history offset", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("walks the next official getHistory offset window after history:1", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      if (target === vkMethodUrl("wall.get")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("messages.getConversations")) {
        return new Response(
          JSON.stringify({
            response: {
              items: [
                {
                  conversation: { peer: { id: 42, type: "user" } },
                  last_message: { id: 120, from_id: 42, text: "latest", date: 1710000120, out: 0 },
                },
              ],
            },
          }),
          { status: 200 },
        );
      }
      if (
        target === vkMethodUrl("photos.getAllComments") ||
        target === vkMethodUrl("video.get") ||
        target === vkMethodUrl("video.getComments") ||
        target === vkMethodUrl("board.getTopics") ||
        target === vkMethodUrl("board.getComments") ||
        target === vkMethodUrl("market.get") ||
        target === vkMethodUrl("market.getComments")
      ) {
        return new Response(
          JSON.stringify({
            error: { error_code: 27, error_msg: "Group authorization failed: method is unavailable with group auth" },
          }),
          { status: 200 },
        );
      }
      expect(target).toBe(vkMethodUrl("messages.getHistory"));
      const body = String(init?.body ?? "");
      if (body.includes("offset=50")) {
        return new Response(
          JSON.stringify({
            response: { items: historyItems(70, 50) },
          }),
          { status: 200 },
        );
      }
      expect(body).not.toContain("offset=");
      return new Response(
        JSON.stringify({
          response: { items: historyItems(120, 50) },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new VkAdapter({
      accessToken: "community-token",
      metadata: communityMetadata,
    }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: "comments:1710000000|history:1|messages:120",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(
      historyItems(70, 50).map((item) => String(item.id)),
    );
    expect(result.cursor).toBe("comments:1710000000|conversations:1|history:2|messages:120|repostpages:1|wall:1|wallcomments:1|wallthreads:done");
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("messages.getHistory"))).toHaveLength(2);
  });

  it("stops offset backfill when the older window is short and skips offset after done", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      if (target === vkMethodUrl("wall.get")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("messages.getConversations")) {
        return new Response(
          JSON.stringify({
            response: {
              items: [
                {
                  conversation: { peer: { id: 42, type: "user" } },
                  last_message: { id: 80, from_id: 42, text: "latest", date: 1710000080, out: 0 },
                },
              ],
            },
          }),
          { status: 200 },
        );
      }
      if (
        target === vkMethodUrl("photos.getAllComments") ||
        target === vkMethodUrl("video.get") ||
        target === vkMethodUrl("video.getComments") ||
        target === vkMethodUrl("board.getTopics") ||
        target === vkMethodUrl("board.getComments") ||
        target === vkMethodUrl("market.get") ||
        target === vkMethodUrl("market.getComments")
      ) {
        return new Response(
          JSON.stringify({
            error: { error_code: 27, error_msg: "Group authorization failed: method is unavailable with group auth" },
          }),
          { status: 200 },
        );
      }
      expect(target).toBe(vkMethodUrl("messages.getHistory"));
      const body = String(init?.body ?? "");
      if (body.includes("offset=")) {
        throw new Error(`unexpected history offset ${body}`);
      }
      return new Response(
        JSON.stringify({
          response: {
            items: [{ id: 81, from_id: 42, text: "newer", date: 1710000081, out: 0, peer_id: 42 }],
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new VkAdapter({
      accessToken: "community-token",
      metadata: communityMetadata,
    }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: "comments:1710000000|history:done|messages:80",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["81"]);
    expect(result.cursor).toBe("comments:1710000000|conversations:1|history:done|messages:81|repostpages:1|wall:1|wallcomments:1|wallthreads:done");
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("messages.getHistory"))).toHaveLength(1);
  });
});
