import { afterEach, describe, expect, it, vi } from "vitest";
import { VkAdapter } from "@/social/vk/adapter";
import { vkMethodUrl } from "@/social/vk/api";
import { vkCommunityMetadata } from "@/social/vk/community";
import { parseVkCommunityHistory, parseVkInboxCursor } from "@/social/vk/inbox";

const communityMetadata = vkCommunityMetadata("12345");

describe("VK community message history", () => {
  it("parses inbound history and skips outbound or chat peers", () => {
    const messages = parseVkCommunityHistory(
      {
        items: [
          { id: 5, from_id: 42, text: "hello club", date: 1710000005, out: 0, peer_id: 42 },
          { id: 4, from_id: -12345, text: "we replied", date: 1710000004, out: 1, peer_id: 42 },
          { id: 3, from_id: 42, text: "   ", date: 1710000003, out: 0, peer_id: 42 },
          { id: 2, from_id: 99, text: "group chat", date: 1710000002, out: 0, peer_id: 2000000001 },
        ],
        profiles: [{ id: 42, screen_name: "lead" }],
      },
      "12345",
    );
    expect(messages).toEqual([
      {
        externalId: "5",
        externalProfileId: "42",
        username: "@lead",
        body: "hello club",
        url: null,
        receivedAt: "2024-03-09T16:00:05.000Z",
        replyKind: "direct_message",
      },
    ]);
  });
});

describe("PHASE 26 VK community history collection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("backfills history when the cursor has no history marker, then stores history:1", async () => {
    expect(parseVkInboxCursor("comments:1|messages:8").history).toBe(false);
    expect(parseVkInboxCursor("comments:1|history:1|messages:8").history).toBe(true);

    const fetchMock = vi.fn(async (url: string) => {
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
                  last_message: { id: 11, from_id: 42, text: "latest", date: 1710000098, out: 0 },
                },
              ],
            },
          }),
          { status: 200 },
        );
      }
      expect(target).toBe(vkMethodUrl("messages.getHistory"));
      return new Response(
        JSON.stringify({
          response: {
            items: [
              { id: 8, from_id: 42, text: "older", date: 1710000001, out: 0, peer_id: 42 },
              { id: 11, from_id: 42, text: "latest", date: 1710000098, out: 0, peer_id: 42 },
            ],
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
      cursor: "comments:1710000000|messages:8",
    });
    expect(result.messages.map((item) => item.externalId).sort()).toEqual(["11", "8"]);
    expect(result.cursor).toBe("comments:1710000000|conversations:1|history:1|messages:11|wall:1|wallcomments:1|wallthreads:done");
  });

  it("skips already-seen history ids after the history marker is stored", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
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
                    last_message: { id: 12, from_id: 42, text: "newer", date: 1710000100, out: 0 },
                  },
                ],
              },
            }),
            { status: 200 },
          );
        }
        expect(target).toBe(vkMethodUrl("messages.getHistory"));
        const body = String(init?.body ?? "");
        if (body.includes("offset=50")) {
          return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
        }
        expect(body).not.toContain("offset=");
        return new Response(
          JSON.stringify({
            response: {
              items: [
                { id: 8, from_id: 42, text: "older", date: 1710000001, out: 0, peer_id: 42 },
                { id: 11, from_id: 42, text: "latest", date: 1710000098, out: 0, peer_id: 42 },
                { id: 12, from_id: 42, text: "newer", date: 1710000100, out: 0, peer_id: 42 },
              ],
            },
          }),
          { status: 200 },
        );
      }),
    );

    const result = await new VkAdapter({
      accessToken: "community-token",
      metadata: communityMetadata,
    }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: "comments:1710000000|history:1|messages:11",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["12"]);
    expect(result.cursor).toBe("comments:1710000000|conversations:1|history:done|messages:12|wall:1|wallcomments:1|wallthreads:done");
  });

  it("does not call messages.getHistory for user OAuth wall-comment inbox", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target === vkMethodUrl("wall.get")) {
        return new Response(JSON.stringify({ response: { items: [{ id: 20, owner_id: 10 }] } }), {
          status: 200,
        });
      }
        if (target === vkMethodUrl("newsfeed.getMentions") || target === vkMethodUrl("photos.getUserPhotos") || target === vkMethodUrl("photos.getComments")) {
          return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
        }
        if (target === vkMethodUrl("photos.getAllComments") || target === vkMethodUrl("photos.getUserPhotos") || target === vkMethodUrl("photos.getComments")) {
          return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
        }
        if (target === vkMethodUrl("video.get") || target === vkMethodUrl("video.getComments")) {
          return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
        }
        expect(target).toBe(vkMethodUrl("wall.getComments"));
      return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await new VkAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: "1710000000",
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url) === vkMethodUrl("messages.getHistory"))).toBe(
      false,
    );
  });
});
