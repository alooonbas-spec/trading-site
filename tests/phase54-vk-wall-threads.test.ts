import { afterEach, describe, expect, it, vi } from "vitest";
import { VkAdapter } from "@/social/vk/adapter";
import { vkMethodUrl } from "@/social/vk/api";
import { encodeVkThreadMap, parseVkThreadId } from "@/social/vk/thread-paging";

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
      text: `nested ${id}`,
      date: dateStart - index,
    };
  });
}

describe("PHASE 54 VK wall comment threads", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses thread ids including community owners", () => {
    expect(parseVkThreadId("10_20_80")).toEqual({ ownerId: "10", postId: "20", commentId: "80" });
    expect(parseVkThreadId("-55_9_4")).toEqual({ ownerId: "-55", postId: "9", commentId: "4" });
    expect(parseVkThreadId("10:20:80")).toBeNull();
    expect(parseVkThreadId("photo:9:4")).toBeNull();
  });

  it("walks the next official comment_id thread window and keeps older nested replies", async () => {
    const nested = nestedReplies(70, 10, 1710000190);
    const older = nestedReplies(50, 10, 1700000050);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      if (
        target === vkMethodUrl("newsfeed.getMentions") || target === vkMethodUrl("photos.getAllComments") || target === vkMethodUrl("photos.getUserPhotos") || target === vkMethodUrl("photos.getComments") ||
        target === vkMethodUrl("video.get") ||
        target === vkMethodUrl("video.getComments")
      ) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("wall.get")) {
        if (body.includes("offset=")) {
          return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
        }
        return new Response(JSON.stringify({ response: { items: [{ id: 20, owner_id: 10 }] } }), { status: 200 });
      }
      expect(target).toBe(vkMethodUrl("wall.getComments"));
      if (body.includes("comment_id=")) {
        expect(body).toContain("comment_id=80");
        expect(body).toContain("post_id=20");
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
                text: "parent",
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
      "10:20:80",
      ...nested.map((item) => `10:20:${item.id}`),
    ]);
    expect(first.cursor).toBe(
      `comments:1710000200|mentionpages:1|photocomments:1|userphotocomments:1|userphotos:1|videocomments:1|videos:1|videothreads:done|wall:1|wallcomments:1|wallthreads:${encodeVkThreadMap({ "10_20_80": "1" })}`,
    );

    const second = await new VkAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: first.cursor,
    });
    expect(second.messages.map((item) => item.externalId)).toEqual(older.map((item) => `10:20:${item.id}`));
    expect(second.cursor).toBe(
      `comments:1710000200|mentionpages:done|photocomments:done|userphotocomments:done|userphotos:done|videocomments:done|videos:done|videothreads:done|wall:done|wallcomments:done|wallthreads:${encodeVkThreadMap({ "10_20_80": "2" })}`,
    );
  });

  it("skips comment_id thread offset once wallthreads:done is stored", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      if (
        target === vkMethodUrl("newsfeed.getMentions") || target === vkMethodUrl("photos.getAllComments") || target === vkMethodUrl("photos.getUserPhotos") || target === vkMethodUrl("photos.getComments") ||
        target === vkMethodUrl("video.get") ||
        target === vkMethodUrl("video.getComments")
      ) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("wall.get")) {
        return new Response(JSON.stringify({ response: { items: [{ id: 20, owner_id: 10 }] } }), { status: 200 });
      }
      expect(target).toBe(vkMethodUrl("wall.getComments"));
      if (body.includes("comment_id=")) {
        throw new Error(`unexpected thread comment_id ${body}`);
      }
      expect(body).toContain("thread_items_count=10");
      return new Response(
        JSON.stringify({
          response: {
            items: [{ id: 81, from_id: 42, text: "newer", date: 1710000081 }],
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new VkAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: "comments:1710000000|wallthreads:done",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["10:20:81"]);
    expect(result.cursor).toContain("wallthreads:done");
  });

  it("stores wallthreads:done for community inbox when no nested threads remain", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target === vkMethodUrl("wall.get") || target === vkMethodUrl("wall.getComments")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("messages.getConversations")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("photos.getAllComments")) {
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
    expect(result.cursor).toBe("conversations:1|history:1|wall:1|wallcomments:1|wallthreads:done");
  });
});
