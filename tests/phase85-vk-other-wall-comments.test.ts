import { afterEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/lib/errors";
import { VkAdapter } from "@/social/vk/adapter";
import { vkMethodUrl } from "@/social/vk/api";
import { parseVkInboxOtherWallCommentRef } from "@/social/vk/inbox";

function otherWallComments(
  startId: number,
  count: number,
  dateStart: number,
): Array<{ id: number; from_id: number; text: string; date: number }> {
  return Array.from({ length: count }, (_, index) => {
    const id = startId - index;
    return {
      id,
      from_id: 42,
      text: `visitor wall comment ${id}`,
      date: dateStart - index,
    };
  });
}

function emptyUnusedCollectors(target: string): Response | null {
  if (
    target === vkMethodUrl("newsfeed.getMentions") ||
    target === vkMethodUrl("photos.getAllComments") ||
    target === vkMethodUrl("photos.getUserPhotos") ||
    target === vkMethodUrl("video.getUserVideos") ||
    target === vkMethodUrl("photos.getComments") ||
    target === vkMethodUrl("video.get") ||
    target === vkMethodUrl("video.getComments") ||
    target === vkMethodUrl("wall.getReposts")
  ) {
    return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
  }
  return null;
}

describe("PHASE 85 VK wall.getComments on filter=others posts", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses other-wall comment refs and refuses mention, owner-wall, or repost ids", () => {
    expect(parseVkInboxOtherWallCommentRef("otherwall:10:80:4")).toEqual({
      ownerId: "10",
      postId: "80",
      commentId: "4",
    });
    expect(parseVkInboxOtherWallCommentRef("otherwall:-10:9:80")).toEqual({
      ownerId: "-10",
      postId: "9",
      commentId: "80",
    });
    expect(() => parseVkInboxOtherWallCommentRef("otherwall:10:80")).toThrow(ValidationError);
    expect(() => parseVkInboxOtherWallCommentRef("10:80:4")).toThrow(ValidationError);
    expect(() => parseVkInboxOtherWallCommentRef("repost:10:80:4")).toThrow(ValidationError);
    expect(() => parseVkInboxOtherWallCommentRef("otherwall:abc:80:4")).toThrow(ValidationError);
  });

  it("walks the next official getComments offset window and keeps older visitor-wall comments", async () => {
    const older = otherWallComments(50, 50, 1700000050);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      const empty = emptyUnusedCollectors(target);
      if (empty) {
        return empty;
      }
      if (target === vkMethodUrl("wall.get")) {
        if (!body.includes("filter=others")) {
          return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
        }
        expect(body).not.toContain("offset=");
        return new Response(
          JSON.stringify({
            response: {
              items: [{ id: 80, owner_id: 10, from_id: 42, text: "newer visitor post", date: 1710000100 }],
            },
          }),
          { status: 200 },
        );
      }
      expect(target).toBe(vkMethodUrl("wall.getComments"));
      expect(body).toContain("count=50");
      expect(body).toContain("sort=desc");
      expect(body).toContain("owner_id=10");
      expect(body).toContain("post_id=80");
      expect(body).toContain("thread_items_count=10");
      expect(body).not.toContain("reply_to_comment=");
      expect(body).not.toContain("comment_id=");
      if (body.includes("offset=50")) {
        return new Response(JSON.stringify({ response: { items: older } }), { status: 200 });
      }
      expect(body).not.toContain("offset=");
      return new Response(
        JSON.stringify({
          response: {
            items: [
              { id: 80, from_id: 42, text: "newer visitor wall comment", date: 1710000200 },
              { id: 79, from_id: 42, text: "   ", date: 1710000199 },
              { id: 78, from_id: 10, text: "owner comment", date: 1710000198 },
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
      cursor: "otherwall:done|otherwallcomments:1",
    });
    expect(first.messages).toEqual([
      {
        externalId: "otherwall:10:80",
        externalProfileId: "42",
        username: null,
        body: "newer visitor post",
        url: "https://vk.com/wall10_80",
        receivedAt: new Date(1710000100 * 1000).toISOString(),
        replyKind: "mention",
      },
      {
        externalId: "otherwall:10:80:80",
        externalProfileId: "42",
        username: null,
        body: "newer visitor wall comment",
        url: "https://vk.com/wall10_80?reply=80",
        receivedAt: new Date(1710000200 * 1000).toISOString(),
        replyKind: "comment",
      },
      ...older.map((item) => ({
        externalId: `otherwall:10:80:${item.id}`,
        externalProfileId: "42",
        username: null,
        body: item.text,
        url: `https://vk.com/wall10_80?reply=${item.id}`,
        receivedAt: new Date(item.date * 1000).toISOString(),
        replyKind: "comment",
      })),
    ]);
    expect(first.cursor).toBe(
      "mentionpages:1|othercomments:1710000200|others:1710000100|otherwall:done|otherwallcomments:2|otherwallthreads:done|photocomments:1|repostpages:1|userphotocomments:1|userphotos:1|uservideocomments:1|uservideos:1|uservideothreads:done|videocomments:1|videos:1|videothreads:done|wall:1|wallcomments:1|wallthreads:done",
    );
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("wall.getComments")),
    ).toHaveLength(2);
  });

  it("collects comments on visitor-wall posts that have no text", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      const empty = emptyUnusedCollectors(target);
      if (empty) {
        return empty;
      }
      if (target === vkMethodUrl("wall.get")) {
        if (!body.includes("filter=others")) {
          return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            response: {
              items: [{ id: 80, owner_id: 10, from_id: 42, date: 1710000100 }],
            },
          }),
          { status: 200 },
        );
      }
      expect(target).toBe(vkMethodUrl("wall.getComments"));
      return new Response(
        JSON.stringify({
          response: {
            items: [{ id: 4, from_id: 42, text: "comment on a textless visitor post", date: 1710000200 }],
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
        externalId: "otherwall:10:80:4",
        externalProfileId: "42",
        username: null,
        body: "comment on a textless visitor post",
        url: "https://vk.com/wall10_80?reply=4",
        receivedAt: new Date(1710000200 * 1000).toISOString(),
        replyKind: "comment",
      },
    ]);
    expect(result.cursor).toBe(
      "mentionpages:1|othercomments:1710000200|otherwall:1|otherwallcomments:1|otherwallthreads:done|photocomments:1|repostpages:1|userphotocomments:1|userphotos:1|uservideocomments:1|uservideos:1|uservideothreads:done|videocomments:1|videos:1|videothreads:done|wall:1|wallcomments:1|wallthreads:done",
    );
  });

  it("skips getComments offset once otherwallcomments:done is stored", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      const empty = emptyUnusedCollectors(target);
      if (empty) {
        return empty;
      }
      if (target === vkMethodUrl("wall.get")) {
        if (!body.includes("filter=others")) {
          return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
        }
        if (body.includes("offset=")) {
          throw new Error(`unexpected others offset ${body}`);
        }
        return new Response(
          JSON.stringify({
            response: {
              items: [{ id: 80, owner_id: 10, from_id: 42, text: "visitor post", date: 1710000100 }],
            },
          }),
          { status: 200 },
        );
      }
      expect(target).toBe(vkMethodUrl("wall.getComments"));
      if (body.includes("offset=")) {
        throw new Error(`unexpected other-wall comments offset ${body}`);
      }
      return new Response(
        JSON.stringify({
          response: {
            items: [{ id: 81, from_id: 42, text: "newer visitor wall comment", date: 1710000081 }],
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new VkAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: "othercomments:1710000000|others:1710000000|otherwall:done|otherwallcomments:done",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["otherwall:10:80", "otherwall:10:80:81"]);
    expect(result.cursor).toBe(
      "mentionpages:1|othercomments:1710000081|others:1710000100|otherwall:done|otherwallcomments:done|otherwallthreads:done|photocomments:1|repostpages:1|userphotocomments:1|userphotos:1|uservideocomments:1|uservideos:1|uservideothreads:done|videocomments:1|videos:1|videothreads:done|wall:1|wallcomments:1|wallthreads:done",
    );
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("wall.getComments")),
    ).toHaveLength(1);
  });

  it("collects community wall.getComments on visitor posts with owner_id of the community wall", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      if (target === vkMethodUrl("wall.getReposts")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (
        target === vkMethodUrl("messages.getConversations") ||
        target === vkMethodUrl("messages.getHistory")
      ) {
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
      if (target === vkMethodUrl("wall.get")) {
        if (!body.includes("filter=others")) {
          return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
        }
        expect(body).toContain("owner_id=-10");
        expect(body).not.toContain("offset=");
        return new Response(
          JSON.stringify({
            response: {
              items: [{ id: 80, owner_id: -10, from_id: 42, text: "community visitor post", date: 1710000100 }],
            },
          }),
          { status: 200 },
        );
      }
      expect(target).toBe(vkMethodUrl("wall.getComments"));
      expect(body).toContain("owner_id=-10");
      expect(body).toContain("post_id=80");
      expect(body).toContain("thread_items_count=10");
      return new Response(
        JSON.stringify({
          response: {
            items: [{ id: 4, from_id: 42, text: "community visitor comment", date: 1710000200 }],
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new VkAdapter({
      accessToken: "community-token",
      metadata: { vkAccountKind: "community", vkGroupId: "10", publishOwnerId: "-10" },
    }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
    });
    expect(result.messages).toEqual([
      {
        externalId: "otherwall:-10:80",
        externalProfileId: "42",
        username: null,
        body: "community visitor post",
        url: "https://vk.com/wall-10_80",
        receivedAt: new Date(1710000100 * 1000).toISOString(),
        replyKind: "mention",
      },
      {
        externalId: "otherwall:-10:80:4",
        externalProfileId: "42",
        username: null,
        body: "community visitor comment",
        url: "https://vk.com/wall-10_80?reply=4",
        receivedAt: new Date(1710000200 * 1000).toISOString(),
        replyKind: "comment",
      },
    ]);
    expect(result.cursor).toBe(
      "conversations:1|history:1|othercomments:1710000200|others:1710000100|otherwall:1|otherwallcomments:1|otherwallthreads:done|repostpages:1|suggestwall:1|wall:1|wallcomments:1|wallthreads:done",
    );
  });

  it("replies to VK other-wall comments through wall.createComment with reply_to_comment", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe(vkMethodUrl("wall.createComment"));
      const body = String(init?.body ?? "");
      expect(body).toContain("owner_id=10");
      expect(body).toContain("post_id=80");
      expect(body).toContain("reply_to_comment=4");
      expect(body).toContain("message=Thanks");
      return new Response(JSON.stringify({ response: { comment_id: 99 } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const sent = await new VkAdapter({ accessToken: "vk-token" }).replyToInbox({
      workspaceId: "w",
      socialAccountId: "a",
      kind: "comment",
      body: "Thanks",
      externalEventId: "otherwall:10:80:4",
      target: { externalProfileId: "42", username: null },
    });
    expect(sent.externalMessageId).toBe("99");
  });
});
