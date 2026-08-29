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
      text: `tagged video nested ${id}`,
      date: dateStart - index,
    };
  });
}

describe("PHASE 81 VK tagged video comment threads", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("walks the next official tagged-video comment_id thread window and keeps older nested replies", async () => {
    const nested = nestedReplies(70, 10, 1710000190);
    const older = nestedReplies(50, 10, 1700000050);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      if (
        target === vkMethodUrl("wall.get") ||
        target === vkMethodUrl("wall.getComments") ||
        target === vkMethodUrl("wall.getReposts") ||
        target === vkMethodUrl("newsfeed.getMentions") ||
        target === vkMethodUrl("photos.getAllComments") ||
        target === vkMethodUrl("photos.getUserPhotos") ||
        target === vkMethodUrl("photos.getComments") ||
        target === vkMethodUrl("video.get")
      ) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("video.getUserVideos")) {
        if (body.includes("offset=")) {
          return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
        }
        expect(body).toContain("count=20");
        return new Response(
          JSON.stringify({ response: { items: [{ id: 20, owner_id: 77, text: "tagged", date: 1710000100 }] } }),
          { status: 200 },
        );
      }
      expect(target).toBe(vkMethodUrl("video.getComments"));
      if (body.includes("comment_id=")) {
        expect(body).toContain("comment_id=80");
        expect(body).toContain("video_id=20");
        expect(body).toContain("owner_id=77");
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
                text: "parent tagged video",
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
      "videotag:77:20",
      "videotag:77:20:80",
      ...nested.map((item) => `videotag:77:20:${item.id}`),
    ]);
    expect(first.cursor).toBe(
      `mentionpages:1|photocomments:1|repostpages:1|userphotocomments:1|userphotos:1|uservideo:1710000200|uservideocomments:1|uservideos:1|uservideothreads:${encodeVkThreadMap({ "77_20_80": "1" })}|videocomments:1|videos:1|videotags:1710000100|videothreads:done|wall:1|wallcomments:1|wallthreads:done`,
    );

    const second = await new VkAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: first.cursor,
    });
    expect(second.messages.map((item) => item.externalId)).toEqual(
      older.map((item) => `videotag:77:20:${item.id}`),
    );
    expect(second.cursor).toBe(
      `mentionpages:done|photocomments:done|repostpages:done|userphotocomments:done|userphotos:done|uservideo:1710000200|uservideocomments:done|uservideos:done|uservideothreads:${encodeVkThreadMap({ "77_20_80": "2" })}|videocomments:done|videos:done|videotags:1710000100|videothreads:done|wall:done|wallcomments:done|wallthreads:done`,
    );
  });

  it("skips tagged-video comment_id offset once uservideothreads:done is stored", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      if (
        target === vkMethodUrl("wall.get") ||
        target === vkMethodUrl("wall.getComments") ||
        target === vkMethodUrl("wall.getReposts") ||
        target === vkMethodUrl("newsfeed.getMentions") ||
        target === vkMethodUrl("photos.getAllComments") ||
        target === vkMethodUrl("photos.getUserPhotos") ||
        target === vkMethodUrl("photos.getComments") ||
        target === vkMethodUrl("video.get")
      ) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("video.getUserVideos")) {
        return new Response(
          JSON.stringify({ response: { items: [{ id: 20, owner_id: 77, text: "tagged", date: 1710000100 }] } }),
          { status: 200 },
        );
      }
      expect(target).toBe(vkMethodUrl("video.getComments"));
      if (body.includes("comment_id=")) {
        throw new Error(`unexpected tagged video thread comment_id ${body}`);
      }
      expect(body).toContain("thread_items_count=10");
      return new Response(
        JSON.stringify({
          response: {
            items: [{ id: 81, from_id: 42, text: "newer tagged video", date: 1710000081 }],
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new VkAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: "uservideo:1710000000|uservideos:done|uservideothreads:done",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["videotag:77:20", "videotag:77:20:81"]);
    expect(result.cursor).toContain("uservideothreads:done");
  });

  it("does not store uservideothreads on community inbox", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target === vkMethodUrl("video.getUserVideos")) {
        throw new Error("community inbox must not call video.getUserVideos");
      }
      if (
        target === vkMethodUrl("wall.get") ||
        target === vkMethodUrl("wall.getComments") ||
        target === vkMethodUrl("wall.getReposts")
      ) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("messages.getConversations")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (
        target === vkMethodUrl("photos.getAllComments") ||
        target === vkMethodUrl("photos.getUserPhotos") ||
        target === vkMethodUrl("photos.getComments") ||
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
    expect(result.cursor).not.toContain("uservideothreads");
    expect(result.cursor).not.toContain("uservideos");
  });

  it("replies to nested tagged video comments through video.createComment", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe(vkMethodUrl("video.createComment"));
      const body = String(init?.body ?? "");
      expect(body).toContain("owner_id=77");
      expect(body).toContain("video_id=20");
      expect(body).toContain("reply_to_comment=70");
      expect(body).toContain("message=Thanks");
      return new Response(JSON.stringify({ response: 99 }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const sent = await new VkAdapter({ accessToken: "vk-token" }).replyToInbox({
      workspaceId: "w",
      socialAccountId: "a",
      kind: "comment",
      body: "Thanks",
      externalEventId: "videotag:77:20:70",
      target: { externalProfileId: "42", username: null },
    });
    expect(sent.externalMessageId).toBe("99");
  });
});
