import { afterEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/lib/errors";
import { VkAdapter } from "@/social/vk/adapter";
import { vkMethodUrl } from "@/social/vk/api";
import { parseVkInboxMentionRef } from "@/social/vk/inbox";

function mentionPosts(
  startId: number,
  count: number,
  dateStart: number,
): Array<{ id: number; owner_id: number; from_id: number; text: string; date: number }> {
  return Array.from({ length: count }, (_, index) => {
    const id = startId - index;
    return {
      id,
      owner_id: 77,
      from_id: 42,
      text: `mentioned ${id}`,
      date: dateStart - index,
    };
  });
}

describe("PHASE 51 VK newsfeed.getMentions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses mention refs and refuses comment ids", () => {
    expect(parseVkInboxMentionRef("77:20")).toEqual({ ownerId: "77", postId: "20" });
    expect(parseVkInboxMentionRef("-100:9")).toEqual({ ownerId: "-100", postId: "9" });
    expect(() => parseVkInboxMentionRef("77:20:3")).toThrow(ValidationError);
    expect(() => parseVkInboxMentionRef("owner:20")).toThrow(ValidationError);
  });

  it("walks the next official getMentions offset window and keeps older mentions", async () => {
    const older = mentionPosts(20, 20, 1700000020);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      if (target === vkMethodUrl("wall.get")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("wall.getComments") || target === vkMethodUrl("wall.getReposts")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("photos.getAllComments") || target === vkMethodUrl("photos.getUserPhotos") || target === vkMethodUrl("video.getUserVideos") || target === vkMethodUrl("photos.getComments")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("video.get") || target === vkMethodUrl("video.getComments")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      expect(target).toBe(vkMethodUrl("newsfeed.getMentions"));
      expect(body).toContain("count=20");
      expect(body).not.toContain("start_time=");
      if (body.includes("offset=20")) {
        return new Response(JSON.stringify({ response: { items: older } }), { status: 200 });
      }
      expect(body).not.toContain("offset=");
      return new Response(
        JSON.stringify({
          response: {
            items: [{ id: 80, owner_id: 77, from_id: 42, text: "newer mention", date: 1710000200 }],
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
        externalId: "77:80",
        externalProfileId: "42",
        username: null,
        body: "newer mention",
        url: "https://vk.com/wall77_80",
        receivedAt: new Date(1710000200 * 1000).toISOString(),
        replyKind: "mention",
      },
    ]);
    expect(first.cursor).toBe("mentionpages:1|mentions:1710000200|otherwall:1|photocomments:1|repostpages:1|userphotocomments:1|userphotos:1|uservideocomments:1|uservideos:1|uservideothreads:done|videocomments:1|videos:1|videothreads:done|wall:1|wallcomments:1|wallthreads:done");
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("newsfeed.getMentions")),
    ).toHaveLength(1);

    const second = await new VkAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: first.cursor,
    });
    expect(second.messages.map((item) => item.externalId)).toEqual(older.map((item) => `77:${item.id}`));
    expect(second.cursor).toBe("mentionpages:2|mentions:1710000200|otherwall:done|photocomments:done|repostpages:done|userphotocomments:done|userphotos:done|uservideocomments:done|uservideos:done|uservideothreads:done|videocomments:done|videos:done|videothreads:done|wall:done|wallcomments:done|wallthreads:done");
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("newsfeed.getMentions")),
    ).toHaveLength(3);
  });

  it("skips getMentions offset once mentionpages:done is stored", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      if (target === vkMethodUrl("wall.get") || target === vkMethodUrl("wall.getComments") || target === vkMethodUrl("wall.getReposts")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("photos.getAllComments") || target === vkMethodUrl("photos.getUserPhotos") || target === vkMethodUrl("video.getUserVideos") || target === vkMethodUrl("photos.getComments")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("video.get") || target === vkMethodUrl("video.getComments")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      expect(target).toBe(vkMethodUrl("newsfeed.getMentions"));
      if (body.includes("offset=")) {
        throw new Error(`unexpected mentions offset ${body}`);
      }
      return new Response(
        JSON.stringify({
          response: {
            items: [{ id: 81, owner_id: 77, from_id: 42, text: "newer mention", date: 1710000081 }],
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new VkAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: "mentionpages:done|mentions:1710000000",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["77:81"]);
    expect(result.cursor).toBe("mentionpages:done|mentions:1710000081|otherwall:1|photocomments:1|repostpages:1|userphotocomments:1|userphotos:1|uservideocomments:1|uservideos:1|uservideothreads:done|videocomments:1|videos:1|videothreads:done|wall:1|wallcomments:1|wallthreads:done");
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("newsfeed.getMentions")),
    ).toHaveLength(1);
  });

  it("does not call newsfeed.getMentions for community inbox", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target === vkMethodUrl("newsfeed.getMentions") || target === vkMethodUrl("photos.getUserPhotos") || target === vkMethodUrl("video.getUserVideos") || target === vkMethodUrl("photos.getComments")) {
        throw new Error("community inbox must not call user newsfeed or photos.getAllComments");
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
      fetchMock.mock.calls.some(([url]) => String(url) === vkMethodUrl("newsfeed.getMentions")),
    ).toBe(false);
  });

  it("replies to VK mentions through wall.createComment on the source post", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe(vkMethodUrl("wall.createComment"));
      const body = String(init?.body ?? "");
      expect(body).toContain("owner_id=77");
      expect(body).toContain("post_id=80");
      expect(body).toContain("message=Thanks");
      expect(body).not.toContain("reply_to_comment=");
      return new Response(JSON.stringify({ response: { comment_id: 99 } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const sent = await new VkAdapter({ accessToken: "vk-token" }).replyToInbox({
      workspaceId: "w",
      socialAccountId: "a",
      kind: "mention",
      body: "Thanks",
      externalEventId: "77:80",
      target: { externalProfileId: "42", username: null },
    });
    expect(sent.externalMessageId).toBe("99");
  });
});
