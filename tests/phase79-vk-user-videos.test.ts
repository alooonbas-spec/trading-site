import { afterEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/lib/errors";
import { VkAdapter } from "@/social/vk/adapter";
import { vkMethodUrl } from "@/social/vk/api";
import { parseVkInboxVideoTagRef } from "@/social/vk/inbox";

function taggedVideos(
  startId: number,
  count: number,
  dateStart: number,
  ownerId = 77,
): Array<{ id: number; owner_id: number; text: string; date: number }> {
  return Array.from({ length: count }, (_, index) => {
    const id = startId - index;
    return {
      id,
      owner_id: ownerId,
      text: `tagged video ${id}`,
      date: dateStart - index,
    };
  });
}

describe("PHASE 79 VK video.getUserVideos", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses video tag refs and refuses video comment or photo tag ids", () => {
    expect(parseVkInboxVideoTagRef("videotag:77:20")).toEqual({ ownerId: "77", videoId: "20" });
    expect(parseVkInboxVideoTagRef("videotag:-100:9")).toEqual({ ownerId: "-100", videoId: "9" });
    expect(() => parseVkInboxVideoTagRef("video:10:20:4")).toThrow(ValidationError);
    expect(() => parseVkInboxVideoTagRef("videotag:77")).toThrow(ValidationError);
    expect(() => parseVkInboxVideoTagRef("videotag:abc:20")).toThrow(ValidationError);
    expect(() => parseVkInboxVideoTagRef("phototag:77:20")).toThrow(ValidationError);
  });

  it("walks the next official getUserVideos offset window and keeps older tagged videos", async () => {
    const older = taggedVideos(20, 20, 1700000020);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      if (target === vkMethodUrl("wall.get") || target === vkMethodUrl("wall.getComments") || target === vkMethodUrl("wall.getReposts")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("newsfeed.getMentions")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("photos.getAllComments") || target === vkMethodUrl("photos.getUserPhotos") || target === vkMethodUrl("photos.getComments")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("video.get") || target === vkMethodUrl("video.getComments")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      expect(target).toBe(vkMethodUrl("video.getUserVideos"));
      expect(body).toContain("count=20");
      expect(body).not.toContain("user_id=");
      if (body.includes("offset=20")) {
        return new Response(JSON.stringify({ response: { items: older } }), { status: 200 });
      }
      expect(body).not.toContain("offset=");
      return new Response(
        JSON.stringify({
          response: {
            items: [
              { id: 80, owner_id: 77, text: "newer tagged video", date: 1710000200 },
              { id: 79, owner_id: 77, text: "   ", date: 1710000199 },
              { id: 78, text: "missing owner", date: 1710000198 },
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
    expect(first.messages).toEqual([
      {
        externalId: "videotag:77:80",
        externalProfileId: "77",
        username: null,
        body: "newer tagged video",
        url: "https://vk.com/video77_80",
        receivedAt: new Date(1710000200 * 1000).toISOString(),
        replyKind: "mention",
      },
    ]);
    expect(first.cursor).toBe(
      "mentionpages:1|photocomments:1|repostpages:1|userphotocomments:1|userphotos:1|uservideocomments:1|uservideos:1|videocomments:1|videos:1|videotags:1710000200|videothreads:done|wall:1|wallcomments:1|wallthreads:done",
    );
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("video.getUserVideos")),
    ).toHaveLength(1);

    const second = await new VkAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: first.cursor,
    });
    expect(second.messages.map((item) => item.externalId)).toEqual(older.map((item) => `videotag:77:${item.id}`));
    expect(second.cursor).toBe(
      "mentionpages:done|photocomments:done|repostpages:done|userphotocomments:done|userphotos:done|uservideocomments:done|uservideos:2|videocomments:done|videos:done|videotags:1710000200|videothreads:done|wall:done|wallcomments:done|wallthreads:done",
    );
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("video.getUserVideos")),
    ).toHaveLength(3);
  });

  it("skips getUserVideos offset once uservideos:done is stored", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      if (target === vkMethodUrl("wall.get") || target === vkMethodUrl("wall.getComments") || target === vkMethodUrl("wall.getReposts")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("newsfeed.getMentions") || target === vkMethodUrl("photos.getAllComments") || target === vkMethodUrl("photos.getUserPhotos") || target === vkMethodUrl("photos.getComments")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("video.get") || target === vkMethodUrl("video.getComments")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      expect(target).toBe(vkMethodUrl("video.getUserVideos"));
      if (body.includes("offset=")) {
        throw new Error(`unexpected user videos offset ${body}`);
      }
      return new Response(
        JSON.stringify({
          response: {
            items: [{ id: 81, owner_id: 77, text: "newer tagged video", date: 1710000081 }],
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new VkAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: "uservideos:done|videotags:1710000000",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["videotag:77:81"]);
    expect(result.cursor).toBe(
      "mentionpages:1|photocomments:1|repostpages:1|userphotocomments:1|userphotos:1|uservideocomments:1|uservideos:done|videocomments:1|videos:1|videotags:1710000081|videothreads:done|wall:1|wallcomments:1|wallthreads:done",
    );
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("video.getUserVideos")),
    ).toHaveLength(1);
  });

  it("does not call video.getUserVideos for community inbox", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target === vkMethodUrl("video.getUserVideos") || target === vkMethodUrl("photos.getUserPhotos") || target === vkMethodUrl("photos.getComments")) {
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

  it("replies to VK video tags through video.createComment on the source video", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe(vkMethodUrl("video.createComment"));
      const body = String(init?.body ?? "");
      expect(body).toContain("owner_id=77");
      expect(body).toContain("video_id=80");
      expect(body).toContain("message=Thanks");
      expect(body).not.toContain("reply_to_comment=");
      return new Response(JSON.stringify({ response: 99 }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const sent = await new VkAdapter({ accessToken: "vk-token" }).replyToInbox({
      workspaceId: "w",
      socialAccountId: "a",
      kind: "mention",
      body: "Thanks",
      externalEventId: "videotag:77:80",
      target: { externalProfileId: "77", username: null },
    });
    expect(sent.externalMessageId).toBe("99");
  });
});
