import { afterEach, describe, expect, it, vi } from "vitest";
import { VkAdapter } from "@/social/vk/adapter";
import { vkMethodUrl } from "@/social/vk/api";
import { parseVkInboxCursor } from "@/social/vk/inbox";

function wallPosts(
  startId: number,
  count: number,
  ownerId = 10,
): Array<{ id: number; owner_id: number }> {
  return Array.from({ length: count }, (_, index) => ({
    id: startId - index,
    owner_id: ownerId,
  }));
}

describe("VK wall offset cursor", () => {
  it("parses wall pages and the done marker", () => {
    expect(parseVkInboxCursor("comments:1|wall:2")).toEqual({
      comments: "1",
      messages: null,
      history: false,
      historyPage: 0,
      conversations: false,
      conversationsPage: 0,
      wall: true,
      wallPage: 2,
      wallcomments: false,
      wallcommentsPage: 0,
    });
    expect(parseVkInboxCursor("comments:1|wall:done")).toEqual({
      comments: "1",
      messages: null,
      history: false,
      historyPage: 0,
      conversations: false,
      conversationsPage: 0,
      wall: true,
      wallPage: "done",
      wallcomments: false,
      wallcommentsPage: 0,
    });
  });
});

describe("PHASE 40 VK wall.get offset", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("walks the next official wall.get offset window after wall:1", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      if (target === vkMethodUrl("wall.get")) {
        if (body.includes("offset=10")) {
          return new Response(
            JSON.stringify({ response: { items: wallPosts(10, 10) } }),
            { status: 200 },
          );
        }
        expect(body).not.toContain("offset=");
        expect(body).toContain("count=10");
        return new Response(
          JSON.stringify({ response: { items: [{ id: 20, owner_id: 10 }] } }),
          { status: 200 },
        );
      }
      if (target === vkMethodUrl("newsfeed.getMentions") || target === vkMethodUrl("photos.getUserPhotos") || target === vkMethodUrl("video.getUserVideos") || target === vkMethodUrl("photos.getComments")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("photos.getAllComments") || target === vkMethodUrl("photos.getUserPhotos") || target === vkMethodUrl("video.getUserVideos") || target === vkMethodUrl("photos.getComments")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("video.get") || target === vkMethodUrl("video.getComments")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("wall.getReposts")) {
      return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      expect(target).toBe(vkMethodUrl("wall.getComments"));
      if (body.includes("post_id=20")) {
        return new Response(
          JSON.stringify({
            response: {
              items: [{ id: 3, from_id: 42, text: "newer", date: 1710000200 }],
            },
          }),
          { status: 200 },
        );
      }
      if (body.includes("post_id=10")) {
        return new Response(
          JSON.stringify({
            response: {
              items: [{ id: 1, from_id: 42, text: "older post", date: 1700000000 }],
            },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new VkAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: "comments:1710000000|wall:1",
    });
    expect(result.messages.map((item) => item.externalId).sort()).toEqual(["10:10:1", "10:20:3"]);
    expect(result.cursor).toBe("comments:1710000200|mentionpages:1|otherwall:1|otherwallcomments:1|otherwallthreads:done|photocomments:1|repostpages:1|userphotocomments:1|userphotos:1|uservideocomments:1|uservideos:1|uservideothreads:done|videocomments:1|videos:1|videothreads:done|wall:2|wallcomments:1|wallthreads:done");
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("wall.get"))).toHaveLength(3);
  });

  it("stores wall:done when the older wall.get window is short", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      if (target === vkMethodUrl("wall.get")) {
        if (body.includes("offset=10")) {
          return new Response(
            JSON.stringify({ response: { items: [{ id: 9, owner_id: 10 }] } }),
            { status: 200 },
          );
        }
        expect(body).not.toContain("offset=");
        return new Response(
          JSON.stringify({ response: { items: [{ id: 20, owner_id: 10 }] } }),
          { status: 200 },
        );
      }
      if (target === vkMethodUrl("newsfeed.getMentions") || target === vkMethodUrl("photos.getUserPhotos") || target === vkMethodUrl("video.getUserVideos") || target === vkMethodUrl("photos.getComments")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("photos.getAllComments") || target === vkMethodUrl("photos.getUserPhotos") || target === vkMethodUrl("video.getUserVideos") || target === vkMethodUrl("photos.getComments")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("video.get") || target === vkMethodUrl("video.getComments")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("wall.getReposts")) {
      return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      expect(target).toBe(vkMethodUrl("wall.getComments"));
      if (body.includes("post_id=9")) {
        return new Response(
          JSON.stringify({
            response: {
              items: [{ id: 1, from_id: 42, text: "older post", date: 1700000000 }],
            },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          response: {
            items: [{ id: 3, from_id: 42, text: "newer", date: 1710000200 }],
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new VkAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: "comments:1710000000|wall:1",
    });
    expect(result.messages.map((item) => item.externalId).sort()).toEqual(["10:20:3", "10:9:1"]);
    expect(result.cursor).toBe("comments:1710000200|mentionpages:1|otherwall:1|otherwallcomments:1|otherwallthreads:done|photocomments:1|repostpages:1|userphotocomments:1|userphotos:1|uservideocomments:1|uservideos:1|uservideothreads:done|videocomments:1|videos:1|videothreads:done|wall:done|wallcomments:1|wallthreads:done");
  });

  it("skips wall.get offset after wall:done and still filters latest comments by unix watermark", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      if (target === vkMethodUrl("wall.get")) {
        if (body.includes("offset=")) {
          throw new Error(`unexpected wall offset ${body}`);
        }
        expect(body).toContain("count=10");
        return new Response(
          JSON.stringify({ response: { items: [{ id: 20, owner_id: 10 }] } }),
          { status: 200 },
        );
      }
      if (target === vkMethodUrl("newsfeed.getMentions") || target === vkMethodUrl("photos.getUserPhotos") || target === vkMethodUrl("video.getUserVideos") || target === vkMethodUrl("photos.getComments")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("photos.getAllComments") || target === vkMethodUrl("photos.getUserPhotos") || target === vkMethodUrl("video.getUserVideos") || target === vkMethodUrl("photos.getComments")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("video.get") || target === vkMethodUrl("video.getComments")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("wall.getReposts")) {
      return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      expect(target).toBe(vkMethodUrl("wall.getComments"));
      return new Response(
        JSON.stringify({
          response: {
            items: [
              { id: 1, from_id: 42, text: "old", date: 1710000000 },
              { id: 2, from_id: 42, text: "new", date: 1710000099 },
            ],
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new VkAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: "comments:1710000000|wall:done",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["10:20:2"]);
    expect(result.cursor).toBe("comments:1710000099|mentionpages:1|otherwall:1|otherwallcomments:1|otherwallthreads:done|photocomments:1|repostpages:1|userphotocomments:1|userphotos:1|uservideocomments:1|uservideos:1|uservideothreads:done|videocomments:1|videos:1|videothreads:done|wall:done|wallcomments:1|wallthreads:done");
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("wall.get"))).toHaveLength(2);
  });
});
