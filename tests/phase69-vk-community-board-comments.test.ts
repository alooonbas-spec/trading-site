import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthenticationError, ValidationError } from "@/lib/errors";
import { VkAdapter } from "@/social/vk/adapter";
import { vkMethodUrl } from "@/social/vk/api";
import { parseVkInboxBoardCommentRef } from "@/social/vk/inbox";

function boardComments(
  startId: number,
  count: number,
  dateStart: number,
): Array<{ id: number; from_id: number; text: string; date: number }> {
  return Array.from({ length: count }, (_, index) => {
    const id = startId - index;
    return {
      id,
      from_id: 42,
      text: `community board ${id}`,
      date: dateStart - index,
    };
  });
}

const communityMetadata = {
  vkAccountKind: "community",
  vkGroupId: "10",
  publishOwnerId: "-10",
};

function photosAndVideoUnavailable(): Response {
  return new Response(
    JSON.stringify({
      error: { error_code: 27, error_msg: "Group authorization failed: method is unavailable with group auth" },
    }),
    { status: 200 },
  );
}

function emptyWallAndConversations(target: string): Response | null {
  if (
    target === vkMethodUrl("wall.get") ||
    target === vkMethodUrl("wall.getComments") || target === vkMethodUrl("wall.getReposts") ||
    target === vkMethodUrl("messages.getConversations") ||
    target === vkMethodUrl("messages.getHistory")
  ) {
    return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
  }
  if (
    target === vkMethodUrl("photos.getAllComments") ||
    target === vkMethodUrl("video.get") ||
    target === vkMethodUrl("video.getComments") ||
    target === vkMethodUrl("market.get") ||
    target === vkMethodUrl("market.getComments")
  ) {
    return photosAndVideoUnavailable();
  }
  return null;
}

describe("PHASE 69 VK community board.getComments", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses board comment refs and refuses video or wall ids", () => {
    expect(parseVkInboxBoardCommentRef("board:10:20:4")).toEqual({
      groupId: "10",
      topicId: "20",
      commentId: "4",
    });
    expect(() => parseVkInboxBoardCommentRef("video:-10:20:4")).toThrow(ValidationError);
    expect(() => parseVkInboxBoardCommentRef("10:20:30")).toThrow(ValidationError);
    expect(() => parseVkInboxBoardCommentRef("board:-10:20:4")).toThrow(ValidationError);
  });

  it("walks the next official community board.getComments offset window and keeps older comments", async () => {
    const older = boardComments(50, 50, 1700000050);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      const empty = emptyWallAndConversations(target);
      if (empty) {
        return empty;
      }
      if (target === vkMethodUrl("board.getTopics")) {
        expect(body).toContain("count=10");
        expect(body).toContain("group_id=10");
        expect(body).not.toContain("owner_id=");
        if (body.includes("offset=")) {
          return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
        }
        return new Response(JSON.stringify({ response: { items: [{ id: 20 }] } }), { status: 200 });
      }
      expect(target).toBe(vkMethodUrl("board.getComments"));
      expect(body).toContain("count=50");
      expect(body).toContain("sort=desc");
      expect(body).toContain("group_id=10");
      expect(body).toContain("topic_id=20");
      expect(body).not.toContain("owner_id=");
      if (body.includes("offset=50")) {
        return new Response(JSON.stringify({ response: { items: older } }), { status: 200 });
      }
      expect(body).not.toContain("offset=");
      return new Response(
        JSON.stringify({
          response: {
            items: [
              { id: 80, from_id: 42, text: "newer community board", date: 1710000200 },
              { id: 79, from_id: -10, text: "own comment", date: 1710000199 },
              { id: 78, from_id: 42, text: "   ", date: 1710000198 },
            ],
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await new VkAdapter({
      accessToken: "community-token",
      metadata: communityMetadata,
    }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
    });
    expect(first.messages).toEqual([
      {
        externalId: "board:10:20:80",
        externalProfileId: "42",
        username: null,
        body: "newer community board",
        url: "https://vk.com/topic-10_20?post=80",
        receivedAt: new Date(1710000200 * 1000).toISOString(),
        replyKind: "comment",
      },
    ]);
    expect(first.cursor).toBe(
      "board:1710000200|boardcomments:1|boardtopics:1|conversations:1|history:1|otherwall:1|repostpages:1|wall:1|wallcomments:1|wallthreads:done",
    );
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("board.getTopics")),
    ).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("board.getComments")),
    ).toHaveLength(1);

    const second = await new VkAdapter({
      accessToken: "community-token",
      metadata: communityMetadata,
    }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: first.cursor,
    });
    expect(second.messages.map((item) => item.externalId)).toEqual(
      older.map((item) => `board:10:20:${item.id}`),
    );
    expect(second.cursor).toBe(
      "board:1710000200|boardcomments:2|boardtopics:done|conversations:done|history:done|otherwall:done|repostpages:done|wall:done|wallcomments:done|wallthreads:done",
    );
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("board.getTopics")),
    ).toHaveLength(3);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("board.getComments")),
    ).toHaveLength(3);
  });

  it("skips board offsets once boardtopics:done and boardcomments:done are stored", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      const empty = emptyWallAndConversations(target);
      if (empty) {
        return empty;
      }
      if (target === vkMethodUrl("board.getTopics")) {
        expect(body).toContain("group_id=10");
        expect(body).not.toContain("offset=");
        return new Response(JSON.stringify({ response: { items: [{ id: 20 }] } }), { status: 200 });
      }
      expect(target).toBe(vkMethodUrl("board.getComments"));
      expect(body).toContain("group_id=10");
      expect(body).not.toContain("offset=");
      return new Response(
        JSON.stringify({
          response: {
            items: [{ id: 81, from_id: 42, text: "newer community board", date: 1710000081 }],
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new VkAdapter({
      accessToken: "community-token",
      metadata: communityMetadata,
    }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: "board:1710000000|boardcomments:done|boardtopics:done",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["board:10:20:81"]);
    expect(result.cursor).toBe(
      "board:1710000081|boardcomments:done|boardtopics:done|conversations:1|history:1|otherwall:1|repostpages:1|wall:1|wallcomments:1|wallthreads:done",
    );
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("board.getTopics")),
    ).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("board.getComments")),
    ).toHaveLength(1);
  });

  it("skips community board comments on VK 7 or 27 without failing wall or Direct Message collection", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      const empty = emptyWallAndConversations(target);
      if (empty) {
        return empty;
      }
      expect(target).toBe(vkMethodUrl("board.getTopics"));
      return new Response(
        JSON.stringify({
          error: { error_code: 7, error_msg: "Permission to perform this action is denied" },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new VkAdapter({
      accessToken: "community-token",
      metadata: communityMetadata,
    }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
    });
    expect(result.messages).toEqual([]);
    expect(result.cursor).toBe("conversations:1|history:1|otherwall:1|repostpages:1|wall:1|wallcomments:1|wallthreads:done");
    expect(result.cursor).not.toContain("board:");
    expect(result.cursor).not.toContain("boardcomments");
    expect(result.cursor).not.toContain("boardtopics");
  });

  it("still fails community inbox on VK 5 and 15 from board.getTopics", async () => {
    for (const code of [5, 15]) {
      const fetchMock = vi.fn(async (url: string) => {
        const target = String(url);
        const empty = emptyWallAndConversations(target);
        if (empty) {
          return empty;
        }
        expect(target).toBe(vkMethodUrl("board.getTopics"));
        return new Response(
          JSON.stringify({
            error: { error_code: code, error_msg: "authorization failed" },
          }),
          { status: 200 },
        );
      });
      vi.stubGlobal("fetch", fetchMock);
      await expect(
        new VkAdapter({
          accessToken: "community-token",
          metadata: communityMetadata,
        }).collectInbox({
          workspaceId: "w",
          socialAccountId: "a",
        }),
      ).rejects.toBeInstanceOf(AuthenticationError);
    }
  });

  it("replies to community board comments through board.createComment as the group", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe(vkMethodUrl("board.createComment"));
      const body = String(init?.body ?? "");
      expect(body).toContain("group_id=10");
      expect(body).toContain("topic_id=20");
      expect(body).toContain("message=Thanks");
      expect(body).toContain("from_group=1");
      expect(body).not.toContain("reply_to_comment=");
      return new Response(JSON.stringify({ response: 99 }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const sent = await new VkAdapter({
      accessToken: "community-token",
      metadata: communityMetadata,
    }).replyToInbox({
      workspaceId: "w",
      socialAccountId: "a",
      kind: "comment",
      body: "Thanks",
      externalEventId: "board:10:20:4",
      target: { externalProfileId: "42", username: null },
    });
    expect(sent.externalMessageId).toBe("99");
  });
});
