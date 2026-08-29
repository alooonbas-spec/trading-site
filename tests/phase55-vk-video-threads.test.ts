import { afterEach, describe, expect, it, vi } from "vitest";
import { VkAdapter } from "@/social/vk/adapter";
import { vkMethodUrl } from "@/social/vk/api";
import { encodeVkThreadMap } from "@/social/vk/thread-paging";

function nestedReplies(
  startId: number,
  count: number,
  dateStart: number,
): Array<{ id: number; from_id: number; text: string; date: number }> {
  return Array.from({ length: count }, (_, index) => {
    const id = startId - index;
    return {
      id,
      from_id: 42,
      text: `video nested ${id}`,
      date: dateStart - index,
    };
  });
}

describe("PHASE 55 VK video comment threads", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("walks the next official video comment_id thread window and keeps older nested replies", async () => {
    const nested = nestedReplies(70, 10, 1710000190);
    const older = nestedReplies(50, 10, 1700000050);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      if (
        target === vkMethodUrl("wall.get") ||
        target === vkMethodUrl("wall.getComments") || target === vkMethodUrl("wall.getReposts") ||
        target === vkMethodUrl("newsfeed.getMentions") || target === vkMethodUrl("photos.getAllComments") || target === vkMethodUrl("photos.getUserPhotos") || target === vkMethodUrl("video.getUserVideos") || target === vkMethodUrl("photos.getComments")
      ) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("video.get")) {
        if (body.includes("offset=")) {
          return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
        }
        expect(body).toContain("count=10");
        return new Response(
          JSON.stringify({ response: { items: [{ id: 20, owner_id: 10 }] } }),
          { status: 200 },
        );
      }
      expect(target).toBe(vkMethodUrl("video.getComments"));
      if (body.includes("comment_id=")) {
        expect(body).toContain("comment_id=80");
        expect(body).toContain("video_id=20");
        expect(body).toContain("owner_id=10");
        expect(body).toContain("count=10");
        expect(body).toContain("sort=desc");
        expect(body).not.toContain("thread_items_count=");
        expect(body).toContain("offset=10");
        return new Response(JSON.stringify({ response: { items: older } }), { status: 200 });
      }
      if (body.includes("offset=")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      expect(body).toContain("thread_items_count=10");
      expect(body).toContain("count=50");
      expect(body).not.toContain("comment_id=");
      return new Response(
        JSON.stringify({
          response: {
            items: [
              {
                id: 80,
                from_id: 42,
                text: "parent video",
                date: 1710000200,
                thread: { count: 20, items: nested },
              },
            ],
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await new VkAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
    });
    expect(first.messages.map((item) => item.externalId)).toEqual([
      "video:10:20:80",
      ...nested.map((item) => `video:10:20:${item.id}`),
    ]);
    expect(first.cursor).toBe(
      `mentionpages:1|otherwall:1|otherwallcomments:1|otherwallthreads:done|photocomments:1|repostpages:1|userphotocomments:1|userphotos:1|uservideocomments:1|uservideos:1|uservideothreads:done|video:1710000200|videocomments:1|videos:1|videothreads:${encodeVkThreadMap({ "10_20_80": "1" })}|wall:1|wallcomments:1|wallthreads:done`,
    );

    const second = await new VkAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: first.cursor,
    });
    expect(second.messages.map((item) => item.externalId)).toEqual(
      older.map((item) => `video:10:20:${item.id}`),
    );
    expect(second.cursor).toBe(
      `mentionpages:done|otherwall:done|otherwallcomments:done|otherwallthreads:done|photocomments:done|repostpages:done|userphotocomments:done|userphotos:done|uservideocomments:done|uservideos:done|uservideothreads:done|video:1710000200|videocomments:done|videos:done|videothreads:${encodeVkThreadMap({ "10_20_80": "2" })}|wall:done|wallcomments:done|wallthreads:done`,
    );
  });

  it("skips video comment_id offset once videothreads:done is stored", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      if (
        target === vkMethodUrl("wall.get") ||
        target === vkMethodUrl("wall.getComments") || target === vkMethodUrl("wall.getReposts") ||
        target === vkMethodUrl("newsfeed.getMentions") || target === vkMethodUrl("photos.getAllComments") || target === vkMethodUrl("photos.getUserPhotos") || target === vkMethodUrl("video.getUserVideos") || target === vkMethodUrl("photos.getComments")
      ) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("video.get")) {
        return new Response(
          JSON.stringify({ response: { items: [{ id: 20, owner_id: 10 }] } }),
          { status: 200 },
        );
      }
      expect(target).toBe(vkMethodUrl("video.getComments"));
      if (body.includes("comment_id=")) {
        throw new Error(`unexpected video thread comment_id ${body}`);
      }
      expect(body).toContain("thread_items_count=10");
      return new Response(
        JSON.stringify({
          response: {
            items: [{ id: 81, from_id: 42, text: "newer video", date: 1710000081 }],
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new VkAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: "video:1710000000|videothreads:done|videos:done",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["video:10:20:81"]);
    expect(result.cursor).toContain("videothreads:done");
  });

  it("isolates unavailable video.getComments for community inbox", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target === vkMethodUrl("wall.get") || target === vkMethodUrl("wall.getComments") || target === vkMethodUrl("wall.getReposts")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("messages.getConversations")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (
        target === vkMethodUrl("photos.getAllComments") ||
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
      if (target === vkMethodUrl("video.get")) {
        return new Response(
          JSON.stringify({ response: { items: [{ id: 20, owner_id: -10 }] } }),
          { status: 200 },
        );
      }
      if (target === vkMethodUrl("video.getComments")) {
        return new Response(
          JSON.stringify({
            error: { error_code: 27, error_msg: "Group authorization failed: method is unavailable with group auth" },
          }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new VkAdapter({
      accessToken: "community-token",
      metadata: { vkAccountKind: "community", vkGroupId: "10", publishOwnerId: "-10" },
    }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url) === vkMethodUrl("video.getComments"))).toBe(
      true,
    );
    expect(result.messages).toEqual([]);
    expect(result.cursor).toBe(
      "conversations:1|history:1|otherwall:1|otherwallcomments:1|otherwallthreads:done|repostpages:1|videocomments:1|videos:1|videothreads:done|wall:1|wallcomments:1|wallthreads:done",
    );
    expect(result.cursor).not.toContain("video:");
  });
});
