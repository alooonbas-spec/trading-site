import { afterEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/lib/errors";
import { VkAdapter } from "@/social/vk/adapter";
import { vkMethodUrl } from "@/social/vk/api";
import { parseVkInboxSuggestRef } from "@/social/vk/inbox";

function suggestPosts(
  startId: number,
  count: number,
  dateStart: number,
  ownerId = -10,
  fromId = 42,
): Array<{ id: number; owner_id: number; from_id: number; text: string; date: number }> {
  return Array.from({ length: count }, (_, index) => {
    const id = startId - index;
    return {
      id,
      owner_id: ownerId,
      from_id: fromId,
      text: `suggested post ${id}`,
      date: dateStart - index,
    };
  });
}

function emptyCommunityCollectors(target: string): Response | null {
  if (target === vkMethodUrl("wall.getComments") || target === vkMethodUrl("wall.getReposts")) {
    return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
  }
  if (target === vkMethodUrl("messages.getConversations") || target === vkMethodUrl("messages.getHistory")) {
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
  return null;
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

describe("PHASE 87 VK wall.get filter=suggests", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses suggested-post refs and refuses mention, comment, other-wall, or repost ids", () => {
    expect(parseVkInboxSuggestRef("suggest:-10:80")).toEqual({ ownerId: "-10", postId: "80" });
    expect(parseVkInboxSuggestRef("suggest:10:9")).toEqual({ ownerId: "10", postId: "9" });
    expect(() => parseVkInboxSuggestRef("10:80")).toThrow(ValidationError);
    expect(() => parseVkInboxSuggestRef("10:80:3")).toThrow(ValidationError);
    expect(() => parseVkInboxSuggestRef("repost:-10:80")).toThrow(ValidationError);
    expect(() => parseVkInboxSuggestRef("otherwall:-10:80")).toThrow(ValidationError);
    expect(() => parseVkInboxSuggestRef("suggest:-10:80:3")).toThrow(ValidationError);
    expect(() => parseVkInboxSuggestRef("suggest:abc:80")).toThrow(ValidationError);
  });

  it("walks the next official wall.get suggests offset window and keeps older suggested posts", async () => {
    const older = suggestPosts(20, 10, 1700000020);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      const empty = emptyCommunityCollectors(target);
      if (empty) {
        return empty;
      }
      expect(target).toBe(vkMethodUrl("wall.get"));
      expect(body).toContain("count=10");
      if (!body.includes("filter=suggests")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      expect(body).toContain("owner_id=-10");
      expect(body).toContain("filter=suggests");
      expect(body).not.toContain("filter=owner");
      expect(body).not.toContain("filter=others");
      if (body.includes("offset=10")) {
        return new Response(JSON.stringify({ response: { items: older } }), { status: 200 });
      }
      expect(body).not.toContain("offset=");
      return new Response(
        JSON.stringify({
          response: {
            items: [
              { id: 80, owner_id: -10, from_id: 42, text: "newer suggested post", date: 1710000200 },
              { id: 79, owner_id: -10, from_id: -10, text: "own suggested post", date: 1710000199 },
              { id: 78, owner_id: -10, from_id: 42, date: 1710000198 },
            ],
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await new VkAdapter({
      accessToken: "community-token",
      metadata: { vkAccountKind: "community", vkGroupId: "10", publishOwnerId: "-10" },
    }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
    });
    expect(first.messages).toEqual([
      {
        externalId: "suggest:-10:80",
        externalProfileId: "42",
        username: null,
        body: "newer suggested post",
        url: "https://vk.com/wall-10_80",
        receivedAt: new Date(1710000200 * 1000).toISOString(),
        replyKind: "mention",
      },
    ]);
    expect(first.cursor).toBe(
      "conversations:1|history:1|otherwall:1|otherwallcomments:1|otherwallthreads:done|repostpages:1|suggests:1710000200|suggestwall:1|wall:1|wallcomments:1|wallthreads:done",
    );
    expect(
      fetchMock.mock.calls.filter(
        ([, init]) =>
          String(init?.body ?? "").includes("filter=suggests") && String(init?.body ?? "").includes("offset=10"),
      ),
    ).toHaveLength(0);

    const second = await new VkAdapter({
      accessToken: "community-token",
      metadata: { vkAccountKind: "community", vkGroupId: "10", publishOwnerId: "-10" },
    }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: first.cursor,
    });
    expect(second.messages.map((item) => item.externalId)).toEqual(older.map((item) => `suggest:-10:${item.id}`));
    expect(second.cursor).toBe(
      "conversations:done|history:done|otherwall:done|otherwallcomments:done|otherwallthreads:done|repostpages:done|suggests:1710000200|suggestwall:2|wall:done|wallcomments:done|wallthreads:done",
    );
    expect(
      fetchMock.mock.calls.filter(
        ([, init]) =>
          String(init?.body ?? "").includes("filter=suggests") && String(init?.body ?? "").includes("offset=10"),
      ),
    ).toHaveLength(1);
  });

  it("skips suggests offset once suggestwall:done is stored", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      const empty = emptyCommunityCollectors(target);
      if (empty) {
        return empty;
      }
      expect(target).toBe(vkMethodUrl("wall.get"));
      if (!body.includes("filter=suggests")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (body.includes("offset=")) {
        throw new Error(`unexpected suggests offset ${body}`);
      }
      return new Response(
        JSON.stringify({
          response: {
            items: [{ id: 81, owner_id: -10, from_id: 42, text: "newer suggested post", date: 1710000081 }],
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
      cursor: "suggests:1710000000|suggestwall:done",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["suggest:-10:81"]);
    expect(result.cursor).toBe(
      "conversations:1|history:1|otherwall:1|otherwallcomments:1|otherwallthreads:done|repostpages:1|suggests:1710000081|suggestwall:done|wall:1|wallcomments:1|wallthreads:done",
    );
    expect(
      fetchMock.mock.calls.filter(([, init]) => String(init?.body ?? "").includes("filter=suggests")),
    ).toHaveLength(1);
  });

  it("does not call wall.get filter=suggests for user OAuth inbox", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      if (body.includes("filter=suggests")) {
        throw new Error("user OAuth inbox must not call wall.get filter=suggests");
      }
      const empty = emptyUserCollectors(target);
      if (empty) {
        return empty;
      }
      expect(target).toBe(vkMethodUrl("wall.get"));
      return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new VkAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
    });
    expect(result.cursor).toBe(
      "mentionpages:1|otherwall:1|otherwallcomments:1|otherwallthreads:done|photocomments:1|repostpages:1|userphotocomments:1|userphotos:1|uservideocomments:1|uservideos:1|uservideothreads:done|videocomments:1|videos:1|videothreads:done|wall:1|wallcomments:1|wallthreads:done",
    );
    expect(result.cursor).not.toContain("suggestwall");
    expect(result.cursor).not.toContain("suggests:");
    expect(
      fetchMock.mock.calls.some(([, init]) => String(init?.body ?? "").includes("filter=suggests")),
    ).toBe(false);
  });

  it("replies to VK suggested posts through wall.createComment on the source post", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe(vkMethodUrl("wall.createComment"));
      const body = String(init?.body ?? "");
      expect(body).toContain("owner_id=-10");
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
      externalEventId: "suggest:-10:80",
      target: { externalProfileId: "42", username: null },
    });
    expect(sent.externalMessageId).toBe("99");
  });
});
