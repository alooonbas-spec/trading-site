import { afterEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/lib/errors";
import { VkAdapter } from "@/social/vk/adapter";
import { vkMethodUrl } from "@/social/vk/api";
import { parseVkInboxOtherWallRef } from "@/social/vk/inbox";

function otherWallPosts(
  startId: number,
  count: number,
  dateStart: number,
  ownerId = 10,
  fromId = 42,
): Array<{ id: number; owner_id: number; from_id: number; text: string; date: number }> {
  return Array.from({ length: count }, (_, index) => {
    const id = startId - index;
    return {
      id,
      owner_id: ownerId,
      from_id: fromId,
      text: `visitor post ${id}`,
      date: dateStart - index,
    };
  });
}

function emptyUserCollectors(target: string): Response | null {
  if (
    target === vkMethodUrl("newsfeed.getMentions") ||
    target === vkMethodUrl("photos.getAllComments") ||
    target === vkMethodUrl("photos.getUserPhotos") ||
    target === vkMethodUrl("video.getUserVideos") ||
    target === vkMethodUrl("photos.getComments") ||
    target === vkMethodUrl("video.get") ||
    target === vkMethodUrl("video.getComments") ||
    target === vkMethodUrl("wall.getComments") ||
    target === vkMethodUrl("wall.getReposts")
  ) {
    return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
  }
  return null;
}

describe("PHASE 84 VK wall.get filter=others", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses other-wall refs and refuses mention, comment, or repost ids", () => {
    expect(parseVkInboxOtherWallRef("otherwall:10:80")).toEqual({ ownerId: "10", postId: "80" });
    expect(parseVkInboxOtherWallRef("otherwall:-10:9")).toEqual({ ownerId: "-10", postId: "9" });
    expect(() => parseVkInboxOtherWallRef("10:80")).toThrow(ValidationError);
    expect(() => parseVkInboxOtherWallRef("10:80:3")).toThrow(ValidationError);
    expect(() => parseVkInboxOtherWallRef("repost:10:80")).toThrow(ValidationError);
    expect(() => parseVkInboxOtherWallRef("otherwall:10:80:3")).toThrow(ValidationError);
    expect(() => parseVkInboxOtherWallRef("otherwall:abc:80")).toThrow(ValidationError);
  });

  it("walks the next official wall.get others offset window and keeps older visitor posts", async () => {
    const older = otherWallPosts(20, 10, 1700000020);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      const empty = emptyUserCollectors(target);
      if (empty) {
        return empty;
      }
      expect(target).toBe(vkMethodUrl("wall.get"));
      expect(body).toContain("count=10");
      if (!body.includes("filter=others")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      expect(body).toContain("filter=others");
      expect(body).not.toContain("filter=owner");
      if (body.includes("offset=10")) {
        return new Response(JSON.stringify({ response: { items: older } }), { status: 200 });
      }
      expect(body).not.toContain("offset=");
      return new Response(
        JSON.stringify({
          response: {
            items: [
              { id: 80, owner_id: 10, from_id: 42, text: "newer visitor post", date: 1710000200 },
              { id: 79, owner_id: 10, from_id: 10, text: "own wall post", date: 1710000199 },
              { id: 78, owner_id: 10, from_id: 42, date: 1710000198 },
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
        externalId: "otherwall:10:80",
        externalProfileId: "42",
        username: null,
        body: "newer visitor post",
        url: "https://vk.com/wall10_80",
        receivedAt: new Date(1710000200 * 1000).toISOString(),
        replyKind: "mention",
      },
    ]);
    expect(first.cursor).toBe(
      "mentionpages:1|others:1710000200|otherwall:1|otherwallcomments:1|otherwallthreads:done|photocomments:1|repostpages:1|userphotocomments:1|userphotos:1|uservideocomments:1|uservideos:1|uservideothreads:done|videocomments:1|videos:1|videothreads:done|wall:1|wallcomments:1|wallthreads:done",
    );
    expect(
      fetchMock.mock.calls.filter(
        ([, init]) => String(init?.body ?? "").includes("filter=others") && String(init?.body ?? "").includes("offset=10"),
      ),
    ).toHaveLength(0);

    const second = await new VkAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: first.cursor,
    });
    expect(second.messages.map((item) => item.externalId)).toEqual(older.map((item) => `otherwall:10:${item.id}`));
    expect(second.cursor).toBe(
      "mentionpages:done|others:1710000200|otherwall:2|otherwallcomments:done|otherwallthreads:done|photocomments:done|repostpages:done|userphotocomments:done|userphotos:done|uservideocomments:done|uservideos:done|uservideothreads:done|videocomments:done|videos:done|videothreads:done|wall:done|wallcomments:done|wallthreads:done",
    );
    expect(
      fetchMock.mock.calls.filter(
        ([, init]) => String(init?.body ?? "").includes("filter=others") && String(init?.body ?? "").includes("offset=10"),
      ),
    ).toHaveLength(1);
  });

  it("skips others offset once otherwall:done is stored", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      const empty = emptyUserCollectors(target);
      if (empty) {
        return empty;
      }
      expect(target).toBe(vkMethodUrl("wall.get"));
      if (!body.includes("filter=others")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (body.includes("offset=")) {
        throw new Error(`unexpected others offset ${body}`);
      }
      return new Response(
        JSON.stringify({
          response: {
            items: [{ id: 81, owner_id: 10, from_id: 42, text: "newer visitor post", date: 1710000081 }],
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new VkAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: "others:1710000000|otherwall:done",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["otherwall:10:81"]);
    expect(result.cursor).toBe(
      "mentionpages:1|others:1710000081|otherwall:done|otherwallcomments:1|otherwallthreads:done|photocomments:1|repostpages:1|userphotocomments:1|userphotos:1|uservideocomments:1|uservideos:1|uservideothreads:done|videocomments:1|videos:1|videothreads:done|wall:1|wallcomments:1|wallthreads:done",
    );
    expect(
      fetchMock.mock.calls.filter(([, init]) => String(init?.body ?? "").includes("filter=others")),
    ).toHaveLength(1);
  });

  it("collects community wall.get others with owner_id of the community wall", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      if (target === vkMethodUrl("wall.getComments") || target === vkMethodUrl("wall.getReposts")) {
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
      expect(target).toBe(vkMethodUrl("wall.get"));
      if (!body.includes("filter=others")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      expect(body).toContain("owner_id=-10");
      expect(body).toContain("filter=others");
      expect(body).not.toContain("offset=");
      return new Response(
        JSON.stringify({
          response: {
            items: [{ id: 80, owner_id: -10, from_id: 42, text: "community visitor post", date: 1710000200 }],
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
        receivedAt: new Date(1710000200 * 1000).toISOString(),
        replyKind: "mention",
      },
    ]);
    expect(result.cursor).toBe(
      "conversations:1|history:1|others:1710000200|otherwall:1|otherwallcomments:1|otherwallthreads:done|repostpages:1|wall:1|wallcomments:1|wallthreads:done",
    );
  });

  it("replies to VK other-wall posts through wall.createComment on the source post", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe(vkMethodUrl("wall.createComment"));
      const body = String(init?.body ?? "");
      expect(body).toContain("owner_id=10");
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
      externalEventId: "otherwall:10:80",
      target: { externalProfileId: "42", username: null },
    });
    expect(sent.externalMessageId).toBe("99");
  });
});
