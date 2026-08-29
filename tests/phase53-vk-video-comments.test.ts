import { afterEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/lib/errors";
import { VkAdapter } from "@/social/vk/adapter";
import { vkMethodUrl } from "@/social/vk/api";
import { parseVkInboxVideoCommentRef } from "@/social/vk/inbox";

function videoItems(startId: number, count: number, ownerId = 10): Array<{ id: number; owner_id: number }> {
  return Array.from({ length: count }, (_, index) => ({
    id: startId - index,
    owner_id: ownerId,
  }));
}

function videoComments(
  startId: number,
  count: number,
  dateStart: number,
): Array<{ id: number; from_id: number; text: string; date: number }> {
  return Array.from({ length: count }, (_, index) => {
    const id = startId - index;
    return {
      id,
      from_id: 42,
      text: `video comment ${id}`,
      date: dateStart - index,
    };
  });
}

describe("PHASE 53 VK video.getComments", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses video comment refs and refuses photo or wall ids", () => {
    expect(parseVkInboxVideoCommentRef("video:10:20:4")).toEqual({
      ownerId: "10",
      videoId: "20",
      commentId: "4",
    });
    expect(parseVkInboxVideoCommentRef("video:-55:9:80")).toEqual({
      ownerId: "-55",
      videoId: "9",
      commentId: "80",
    });
    expect(() => parseVkInboxVideoCommentRef("photo:9:4")).toThrow(ValidationError);
    expect(() => parseVkInboxVideoCommentRef("10:20:30")).toThrow(ValidationError);
    expect(() => parseVkInboxVideoCommentRef("video:20:4")).toThrow(ValidationError);
  });

  it("walks the next official getComments offset window and keeps older video comments", async () => {
    const older = videoComments(50, 50, 1700000050);
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
        expect(body).toContain("count=10");
        expect(body).not.toContain("owner_id=");
        expect(body).not.toContain("album_id=");
        if (body.includes("offset=")) {
          throw new Error(`unexpected video offset ${body}`);
        }
        return new Response(
          JSON.stringify({ response: { items: [{ id: 20, owner_id: 10 }] } }),
          { status: 200 },
        );
      }
      expect(target).toBe(vkMethodUrl("video.getComments"));
      expect(body).toContain("count=50");
      expect(body).toContain("sort=desc");
      expect(body).toContain("owner_id=10");
      expect(body).toContain("video_id=20");
      if (body.includes("offset=50")) {
        return new Response(JSON.stringify({ response: { items: older } }), { status: 200 });
      }
      expect(body).not.toContain("offset=");
      return new Response(
        JSON.stringify({
          response: {
            items: [
              { id: 80, from_id: 42, text: "newer video", date: 1710000200 },
              { id: 79, from_id: 10, text: "own comment", date: 1710000199 },
              { id: 78, from_id: 42, text: "   ", date: 1710000198 },
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
      cursor: "videocomments:1|videos:done",
    });
    expect(first.messages).toEqual([
      {
        externalId: "video:10:20:80",
        externalProfileId: "42",
        username: null,
        body: "newer video",
        url: "https://vk.com/video10_20?reply=80",
        receivedAt: new Date(1710000200 * 1000).toISOString(),
        replyKind: "comment",
      },
      ...older.map((item) => ({
        externalId: `video:10:20:${item.id}`,
        externalProfileId: "42",
        username: null,
        body: item.text,
        url: `https://vk.com/video10_20?reply=${item.id}`,
        receivedAt: new Date(item.date * 1000).toISOString(),
        replyKind: "comment",
      })),
    ]);
    expect(first.cursor).toBe(
      "mentionpages:1|photocomments:1|repostpages:1|userphotocomments:1|userphotos:1|uservideocomments:1|uservideos:1|video:1710000200|videocomments:2|videos:done|videothreads:done|wall:1|wallcomments:1|wallthreads:done",
    );
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("video.getComments")),
    ).toHaveLength(2);
  });

  it("walks the next official video.get offset window and keeps older videos' comments", async () => {
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
        expect(body).toContain("count=10");
        if (body.includes("offset=10")) {
          return new Response(JSON.stringify({ response: { items: videoItems(10, 10) } }), { status: 200 });
        }
        expect(body).not.toContain("offset=");
        return new Response(
          JSON.stringify({ response: { items: [{ id: 20, owner_id: 10 }] } }),
          { status: 200 },
        );
      }
      expect(target).toBe(vkMethodUrl("video.getComments"));
      if (body.includes("video_id=20")) {
        return new Response(
          JSON.stringify({
            response: {
              items: [{ id: 3, from_id: 42, text: "newer", date: 1710000200 }],
            },
          }),
          { status: 200 },
        );
      }
      if (body.includes("video_id=10")) {
        return new Response(
          JSON.stringify({
            response: {
              items: [{ id: 1, from_id: 42, text: "older video", date: 1700000000 }],
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
      cursor: "video:1710000000|videos:1",
    });
    expect(result.messages.map((item) => item.externalId).sort()).toEqual(["video:10:10:1", "video:10:20:3"]);
    expect(result.cursor).toBe(
      "mentionpages:1|photocomments:1|repostpages:1|userphotocomments:1|userphotos:1|uservideocomments:1|uservideos:1|video:1710000200|videocomments:1|videos:2|videothreads:done|wall:1|wallcomments:1|wallthreads:done",
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("video.get"))).toHaveLength(2);
  });

  it("skips video offsets once videos:done and videocomments:done are stored", async () => {
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
          throw new Error(`unexpected video offset ${body}`);
        }
        expect(body).toContain("count=10");
        return new Response(
          JSON.stringify({ response: { items: [{ id: 20, owner_id: 10 }] } }),
          { status: 200 },
        );
      }
      expect(target).toBe(vkMethodUrl("video.getComments"));
      if (body.includes("offset=")) {
        throw new Error(`unexpected video comments offset ${body}`);
      }
      expect(body).toContain("count=50");
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
      cursor: "video:1710000000|videocomments:done|videos:done",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["video:10:20:81"]);
    expect(result.cursor).toBe(
      "mentionpages:1|photocomments:1|repostpages:1|userphotocomments:1|userphotos:1|uservideocomments:1|uservideos:1|video:1710000081|videocomments:done|videos:done|videothreads:done|wall:1|wallcomments:1|wallthreads:done",
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("video.get"))).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("video.getComments")),
    ).toHaveLength(1);
  });

  it("isolates unavailable video.get for community inbox", async () => {
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
    expect(fetchMock.mock.calls.some(([url]) => String(url) === vkMethodUrl("video.get"))).toBe(true);
    expect(result.cursor).toBe("conversations:1|history:1|repostpages:1|wall:1|wallcomments:1|wallthreads:done");
    expect(result.cursor).not.toContain("videos");
    expect(result.cursor).not.toContain("videocomments");
    expect(result.cursor).not.toContain("videothreads");
    expect(result.cursor).not.toContain("video:");
  });

  it("replies to VK video comments through video.createComment", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe(vkMethodUrl("video.createComment"));
      const body = String(init?.body ?? "");
      expect(body).toContain("owner_id=10");
      expect(body).toContain("video_id=20");
      expect(body).toContain("reply_to_comment=4");
      expect(body).toContain("message=Thanks");
      return new Response(JSON.stringify({ response: 99 }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const sent = await new VkAdapter({ accessToken: "vk-token" }).replyToInbox({
      workspaceId: "w",
      socialAccountId: "a",
      kind: "comment",
      body: "Thanks",
      externalEventId: "video:10:20:4",
      target: { externalProfileId: "42", username: null },
    });
    expect(sent.externalMessageId).toBe("99");
  });
});
