import { afterEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/lib/errors";
import { VkAdapter } from "@/social/vk/adapter";
import { vkMethodUrl } from "@/social/vk/api";
import { parseVkInboxVideoTagCommentRef } from "@/social/vk/inbox";

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
      text: `tagged video comment ${id}`,
      date: dateStart - index,
    };
  });
}

describe("PHASE 80 VK video.getComments on tagged videos", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses tagged video comment refs and refuses mention or own-video comment ids", () => {
    expect(parseVkInboxVideoTagCommentRef("videotag:77:20:4")).toEqual({
      ownerId: "77",
      videoId: "20",
      commentId: "4",
    });
    expect(parseVkInboxVideoTagCommentRef("videotag:-100:9:80")).toEqual({
      ownerId: "-100",
      videoId: "9",
      commentId: "80",
    });
    expect(() => parseVkInboxVideoTagCommentRef("videotag:77:20")).toThrow(ValidationError);
    expect(() => parseVkInboxVideoTagCommentRef("video:10:20:4")).toThrow(ValidationError);
    expect(() => parseVkInboxVideoTagCommentRef("videotag:abc:20:4")).toThrow(ValidationError);
  });

  it("walks the next official getComments offset window and keeps older tagged-video comments", async () => {
    const older = videoComments(50, 50, 1700000050);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      if (
        target === vkMethodUrl("wall.get") ||
        target === vkMethodUrl("wall.getComments") || target === vkMethodUrl("wall.getReposts") ||
        target === vkMethodUrl("newsfeed.getMentions") ||
        target === vkMethodUrl("photos.getAllComments") ||
        target === vkMethodUrl("photos.getUserPhotos") ||
        target === vkMethodUrl("photos.getComments")
      ) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("video.get")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("video.getUserVideos")) {
        expect(body).not.toContain("offset=");
        return new Response(
          JSON.stringify({ response: { items: [{ id: 20, owner_id: 77, text: "tagged", date: 1710000100 }] } }),
          { status: 200 },
        );
      }
      expect(target).toBe(vkMethodUrl("video.getComments"));
      expect(body).toContain("count=50");
      expect(body).toContain("sort=desc");
      expect(body).toContain("owner_id=77");
      expect(body).toContain("video_id=20");
      if (body.includes("offset=50")) {
        return new Response(JSON.stringify({ response: { items: older } }), { status: 200 });
      }
      expect(body).not.toContain("offset=");
      return new Response(
        JSON.stringify({
          response: {
            items: [
              { id: 80, from_id: 42, text: "newer tagged video comment", date: 1710000200 },
              { id: 79, from_id: 42, text: "   ", date: 1710000199 },
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
      cursor: "uservideocomments:1|uservideos:done",
    });
    expect(first.messages).toEqual([
      {
        externalId: "videotag:77:20",
        externalProfileId: "77",
        username: null,
        body: "tagged",
        url: "https://vk.com/video77_20",
        receivedAt: new Date(1710000100 * 1000).toISOString(),
        replyKind: "mention",
      },
      {
        externalId: "videotag:77:20:80",
        externalProfileId: "42",
        username: null,
        body: "newer tagged video comment",
        url: "https://vk.com/video77_20?reply=80",
        receivedAt: new Date(1710000200 * 1000).toISOString(),
        replyKind: "comment",
      },
      ...older.map((item) => ({
        externalId: `videotag:77:20:${item.id}`,
        externalProfileId: "42",
        username: null,
        body: item.text,
        url: `https://vk.com/video77_20?reply=${item.id}`,
        receivedAt: new Date(item.date * 1000).toISOString(),
        replyKind: "comment",
      })),
    ]);
    expect(first.cursor).toBe(
      "mentionpages:1|otherwall:1|photocomments:1|repostpages:1|userphotocomments:1|userphotos:1|uservideo:1710000200|uservideocomments:2|uservideos:done|uservideothreads:done|videocomments:1|videos:1|videotags:1710000100|videothreads:done|wall:1|wallcomments:1|wallthreads:done",
    );
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("video.getComments")),
    ).toHaveLength(2);
  });

  it("collects comments on tagged videos that have no caption text", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (
        target === vkMethodUrl("wall.get") ||
        target === vkMethodUrl("wall.getComments") || target === vkMethodUrl("wall.getReposts") ||
        target === vkMethodUrl("newsfeed.getMentions") ||
        target === vkMethodUrl("photos.getAllComments") ||
        target === vkMethodUrl("photos.getUserPhotos") ||
        target === vkMethodUrl("photos.getComments") ||
        target === vkMethodUrl("video.get") ||
        target === vkMethodUrl("board.getTopics") ||
        target === vkMethodUrl("board.getComments") ||
        target === vkMethodUrl("market.get") ||
        target === vkMethodUrl("market.getComments")
      ) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("video.getUserVideos")) {
        return new Response(
          JSON.stringify({
            response: {
              items: [{ id: 20, owner_id: 77, date: 1710000100 }],
            },
          }),
          { status: 200 },
        );
      }
      expect(target).toBe(vkMethodUrl("video.getComments"));
      return new Response(
        JSON.stringify({
          response: {
            items: [{ id: 4, from_id: 42, text: "comment on a video-only tag", date: 1710000200 }],
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new VkAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
    });
    expect(result.messages).toEqual([
      {
        externalId: "videotag:77:20:4",
        externalProfileId: "42",
        username: null,
        body: "comment on a video-only tag",
        url: "https://vk.com/video77_20?reply=4",
        receivedAt: new Date(1710000200 * 1000).toISOString(),
        replyKind: "comment",
      },
    ]);
    expect(result.cursor).toBe(
      "mentionpages:1|otherwall:1|photocomments:1|repostpages:1|userphotocomments:1|userphotos:1|uservideo:1710000200|uservideocomments:1|uservideos:1|uservideothreads:done|videocomments:1|videos:1|videothreads:done|wall:1|wallcomments:1|wallthreads:done",
    );
  });

  it("skips getComments offset once uservideocomments:done is stored", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      if (
        target === vkMethodUrl("wall.get") ||
        target === vkMethodUrl("wall.getComments") || target === vkMethodUrl("wall.getReposts") ||
        target === vkMethodUrl("newsfeed.getMentions") ||
        target === vkMethodUrl("photos.getAllComments") ||
        target === vkMethodUrl("photos.getUserPhotos") ||
        target === vkMethodUrl("photos.getComments") ||
        target === vkMethodUrl("video.get") ||
        target === vkMethodUrl("board.getTopics") ||
        target === vkMethodUrl("board.getComments") ||
        target === vkMethodUrl("market.get") ||
        target === vkMethodUrl("market.getComments")
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
      if (body.includes("offset=")) {
        throw new Error(`unexpected tagged video comments offset ${body}`);
      }
      return new Response(
        JSON.stringify({
          response: {
            items: [{ id: 81, from_id: 42, text: "newer tagged video comment", date: 1710000081 }],
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new VkAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: "uservideo:1710000000|uservideocomments:done|uservideos:done",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["videotag:77:20", "videotag:77:20:81"]);
    expect(result.cursor).toBe(
      "mentionpages:1|otherwall:1|photocomments:1|repostpages:1|userphotocomments:1|userphotos:1|uservideo:1710000081|uservideocomments:done|uservideos:done|uservideothreads:done|videocomments:1|videos:1|videotags:1710000100|videothreads:done|wall:1|wallcomments:1|wallthreads:done",
    );
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("video.getComments")),
    ).toHaveLength(1);
  });

  it("does not call video.getUserVideos for community inbox", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target === vkMethodUrl("video.getUserVideos")) {
        throw new Error("community inbox must not call video.getUserVideos");
      }
      if (target === vkMethodUrl("wall.get") || target === vkMethodUrl("wall.getComments") || target === vkMethodUrl("wall.getReposts")) {
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

    await new VkAdapter({
      accessToken: "community-token",
      metadata: { vkAccountKind: "community", vkGroupId: "10", publishOwnerId: "-10" },
    }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
    });
    expect(
      fetchMock.mock.calls.some(([url]) => String(url) === vkMethodUrl("video.getUserVideos")),
    ).toBe(false);
  });

  it("replies to tagged video comments through video.createComment", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe(vkMethodUrl("video.createComment"));
      const body = String(init?.body ?? "");
      expect(body).toContain("owner_id=77");
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
      externalEventId: "videotag:77:20:4",
      target: { externalProfileId: "42", username: null },
    });
    expect(sent.externalMessageId).toBe("99");
  });
});
