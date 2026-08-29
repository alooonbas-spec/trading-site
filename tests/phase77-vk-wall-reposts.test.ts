import { afterEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/lib/errors";
import { VkAdapter } from "@/social/vk/adapter";
import { vkMethodUrl } from "@/social/vk/api";
import { parseVkInboxRepostRef } from "@/social/vk/inbox";

function repostItems(
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
      text: `reposted ${id}`,
      date: dateStart - index,
    };
  });
}

function emptyUserCollectors(target: string): Response | null {
  if (
    target === vkMethodUrl("newsfeed.getMentions") ||
    target === vkMethodUrl("photos.getAllComments") ||
    target === vkMethodUrl("photos.getUserPhotos") || target === vkMethodUrl("video.getUserVideos") ||
    target === vkMethodUrl("photos.getComments") ||
    target === vkMethodUrl("video.get") ||
    target === vkMethodUrl("video.getComments") ||
    target === vkMethodUrl("wall.getComments")
  ) {
    return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
  }
  return null;
}

describe("PHASE 77 VK wall.getReposts", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses repost refs and refuses mention or comment ids", () => {
    expect(parseVkInboxRepostRef("repost:77:20")).toEqual({ ownerId: "77", postId: "20" });
    expect(parseVkInboxRepostRef("repost:-100:9")).toEqual({ ownerId: "-100", postId: "9" });
    expect(() => parseVkInboxRepostRef("77:20")).toThrow(ValidationError);
    expect(() => parseVkInboxRepostRef("10:20:3")).toThrow(ValidationError);
    expect(() => parseVkInboxRepostRef("phototag:77:20")).toThrow(ValidationError);
    expect(() => parseVkInboxRepostRef("repost:77:20:3")).toThrow(ValidationError);
  });

  it("walks the next official getReposts offset window and keeps older reposts", async () => {
    const older = repostItems(20, 20, 1700000020);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      const empty = emptyUserCollectors(target);
      if (empty) {
        return empty;
      }
      if (target === vkMethodUrl("wall.get")) {
        if (body.includes("offset=")) {
          return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
        }
        return new Response(JSON.stringify({ response: { items: [{ id: 9001, owner_id: 10 }] } }), {
          status: 200,
        });
      }
      expect(target).toBe(vkMethodUrl("wall.getReposts"));
      expect(body).toContain("count=20");
      expect(body).toContain("post_id=9001");
      expect(body).toContain("owner_id=10");
      if (body.includes("offset=20")) {
        return new Response(JSON.stringify({ response: { items: older } }), { status: 200 });
      }
      expect(body).not.toContain("offset=");
      return new Response(
        JSON.stringify({
          response: {
            items: [
              { id: 80, owner_id: 77, from_id: 42, text: "newer repost", date: 1710000200 },
              { id: 79, owner_id: 77, from_id: 10, text: "own share", date: 1710000199 },
              { id: 78, owner_id: 77, from_id: 42, date: 1710000198 },
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
        externalId: "repost:77:80",
        externalProfileId: "42",
        username: null,
        body: "newer repost",
        url: "https://vk.com/wall77_80",
        receivedAt: new Date(1710000200 * 1000).toISOString(),
        replyKind: "mention",
      },
    ]);
    expect(first.cursor).toBe(
      "mentionpages:1|photocomments:1|repostpages:1|reposts:1710000200|userphotocomments:1|userphotos:1|uservideocomments:1|uservideos:1|videocomments:1|videos:1|videothreads:done|wall:1|wallcomments:1|wallthreads:done",
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("wall.getReposts"))).toHaveLength(1);

    const second = await new VkAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: first.cursor,
    });
    expect(second.messages.map((item) => item.externalId)).toEqual(older.map((item) => `repost:77:${item.id}`));
    expect(second.cursor).toBe(
      "mentionpages:done|photocomments:done|repostpages:2|reposts:1710000200|userphotocomments:done|userphotos:done|uservideocomments:done|uservideos:done|videocomments:done|videos:done|videothreads:done|wall:done|wallcomments:done|wallthreads:done",
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("wall.getReposts"))).toHaveLength(3);
  });

  it("skips getReposts offset once repostpages:done is stored", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      const empty = emptyUserCollectors(target);
      if (empty) {
        return empty;
      }
      if (target === vkMethodUrl("wall.get")) {
        return new Response(JSON.stringify({ response: { items: [{ id: 9001, owner_id: 10 }] } }), {
          status: 200,
        });
      }
      expect(target).toBe(vkMethodUrl("wall.getReposts"));
      if (body.includes("offset=")) {
        throw new Error(`unexpected reposts offset ${body}`);
      }
      return new Response(
        JSON.stringify({
          response: {
            items: [{ id: 81, owner_id: 77, from_id: 42, text: "newer repost", date: 1710000081 }],
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new VkAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: "repostpages:done|reposts:1710000000",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["repost:77:81"]);
    expect(result.cursor).toBe(
      "mentionpages:1|photocomments:1|repostpages:done|reposts:1710000081|userphotocomments:1|userphotos:1|uservideocomments:1|uservideos:1|videocomments:1|videos:1|videothreads:done|wall:1|wallcomments:1|wallthreads:done",
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("wall.getReposts"))).toHaveLength(1);
  });

  it("does not drop extra-page reposts by the unix reposts watermark", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      const empty = emptyUserCollectors(target);
      if (empty) {
        return empty;
      }
      if (target === vkMethodUrl("wall.get")) {
        return new Response(JSON.stringify({ response: { items: [{ id: 9001, owner_id: 10 }] } }), {
          status: 200,
        });
      }
      expect(target).toBe(vkMethodUrl("wall.getReposts"));
      if (body.includes("offset=20")) {
        return new Response(
          JSON.stringify({
            response: {
              items: [{ id: 9, owner_id: 77, from_id: 42, text: "older page", date: 1700000009 }],
            },
          }),
          { status: 200 },
        );
      }
      expect(body).not.toContain("offset=");
      return new Response(
        JSON.stringify({
          response: {
            items: [{ id: 81, owner_id: 77, from_id: 42, text: "newer repost", date: 1710000081 }],
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new VkAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: "reposts:1710000000|repostpages:1",
    });
    expect(result.messages.map((item) => item.externalId).sort()).toEqual(["repost:77:81", "repost:77:9"]);
    expect(result.cursor).toBe(
      "mentionpages:1|photocomments:1|repostpages:done|reposts:1710000081|userphotocomments:1|userphotos:1|uservideocomments:1|uservideos:1|videocomments:1|videos:1|videothreads:done|wall:1|wallcomments:1|wallthreads:done",
    );
  });

  it("replies to VK wall reposts through wall.createComment on the repost", async () => {
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
      externalEventId: "repost:77:80",
      target: { externalProfileId: "42", username: null },
    });
    expect(sent.externalMessageId).toBe("99");
  });

  it("collects community wall.getReposts with owner_id of the community wall", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      if (target === vkMethodUrl("wall.get")) {
        return new Response(JSON.stringify({ response: { items: [{ id: 9001, owner_id: -10 }] } }), {
          status: 200,
        });
      }
      if (target === vkMethodUrl("wall.getComments")) {
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
      expect(target).toBe(vkMethodUrl("wall.getReposts"));
      expect(body).toContain("owner_id=-10");
      expect(body).toContain("post_id=9001");
      expect(body).not.toContain("offset=");
      return new Response(
        JSON.stringify({
          response: {
            items: [{ id: 80, owner_id: 77, from_id: 42, text: "community share", date: 1710000200 }],
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
        externalId: "repost:77:80",
        externalProfileId: "42",
        username: null,
        body: "community share",
        url: "https://vk.com/wall77_80",
        receivedAt: new Date(1710000200 * 1000).toISOString(),
        replyKind: "mention",
      },
    ]);
    expect(result.cursor).toBe(
      "conversations:1|history:1|repostpages:1|reposts:1710000200|wall:1|wallcomments:1|wallthreads:done",
    );
  });
});
