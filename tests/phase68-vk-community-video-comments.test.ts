import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthenticationError } from "@/lib/errors";
import { VkAdapter } from "@/social/vk/adapter";
import { vkMethodUrl } from "@/social/vk/api";

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
      text: `community video ${id}`,
      date: dateStart - index,
    };
  });
}

const communityMetadata = {
  vkAccountKind: "community",
  vkGroupId: "10",
  publishOwnerId: "-10",
};

function photosUnavailable(): Response {
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

describe("PHASE 68 VK community video.getComments", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("walks the next official community video.getComments offset window and keeps older comments", async () => {
    const older = videoComments(50, 50, 1700000050);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      const empty = emptyWallAndConversations(target);
      if (empty) {
        return empty;
      }
      if (target === vkMethodUrl("photos.getAllComments")) {
        return photosUnavailable();
      }
      if (target === vkMethodUrl("video.get")) {
        expect(body).toContain("count=10");
        expect(body).toContain("owner_id=-10");
        expect(body).not.toContain("album_id=");
        if (body.includes("offset=")) {
          return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
        }
        return new Response(
          JSON.stringify({ response: { items: [{ id: 20, owner_id: -10 }] } }),
          { status: 200 },
        );
      }
      expect(target).toBe(vkMethodUrl("video.getComments"));
      expect(body).toContain("count=50");
      expect(body).toContain("sort=desc");
      expect(body).toContain("owner_id=-10");
      expect(body).toContain("video_id=20");
      expect(body).toContain("thread_items_count=10");
      if (body.includes("offset=50")) {
        return new Response(JSON.stringify({ response: { items: older } }), { status: 200 });
      }
      expect(body).not.toContain("offset=");
      return new Response(
        JSON.stringify({
          response: {
            items: [
              { id: 80, from_id: 42, text: "newer community video", date: 1710000200 },
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
        externalId: "video:-10:20:80",
        externalProfileId: "42",
        username: null,
        body: "newer community video",
        url: "https://vk.com/video-10_20?reply=80",
        receivedAt: new Date(1710000200 * 1000).toISOString(),
        replyKind: "comment",
      },
    ]);
    expect(first.cursor).toBe(
      "conversations:1|history:1|otherwall:1|repostpages:1|video:1710000200|videocomments:1|videos:1|videothreads:done|wall:1|wallcomments:1|wallthreads:done",
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("video.get"))).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("video.getComments")),
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
      older.map((item) => `video:-10:20:${item.id}`),
    );
    expect(second.cursor).toBe(
      "conversations:done|history:done|otherwall:done|repostpages:done|video:1710000200|videocomments:2|videos:done|videothreads:done|wall:done|wallcomments:done|wallthreads:done",
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("video.get"))).toHaveLength(3);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("video.getComments")),
    ).toHaveLength(3);
  });

  it("skips video offsets once videos:done and videocomments:done are stored", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      const empty = emptyWallAndConversations(target);
      if (empty) {
        return empty;
      }
      if (target === vkMethodUrl("photos.getAllComments")) {
        return photosUnavailable();
      }
      if (target === vkMethodUrl("video.get")) {
        expect(body).toContain("owner_id=-10");
        expect(body).not.toContain("offset=");
        expect(body).not.toContain("album_id=");
        return new Response(
          JSON.stringify({ response: { items: [{ id: 20, owner_id: -10 }] } }),
          { status: 200 },
        );
      }
      expect(target).toBe(vkMethodUrl("video.getComments"));
      expect(body).toContain("owner_id=-10");
      expect(body).not.toContain("offset=");
      return new Response(
        JSON.stringify({
          response: {
            items: [{ id: 81, from_id: 42, text: "newer community video", date: 1710000081 }],
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
      cursor: "video:1710000000|videocomments:done|videos:done",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["video:-10:20:81"]);
    expect(result.cursor).toBe(
      "conversations:1|history:1|otherwall:1|repostpages:1|video:1710000081|videocomments:done|videos:done|videothreads:done|wall:1|wallcomments:1|wallthreads:done",
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("video.get"))).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("video.getComments")),
    ).toHaveLength(1);
  });

  it("skips community video comments on VK 7 or 27 without failing wall or Direct Message collection", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      const empty = emptyWallAndConversations(target);
      if (empty) {
        return empty;
      }
      if (target === vkMethodUrl("photos.getAllComments")) {
        return photosUnavailable();
      }
      expect(target).toBe(vkMethodUrl("video.get"));
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
    expect(result.cursor).not.toContain("videos");
    expect(result.cursor).not.toContain("videocomments");
    expect(result.cursor).not.toContain("videothreads");
    expect(result.cursor).not.toContain("video:");
  });

  it("still fails community inbox on VK 5 and 15 from video.get", async () => {
    for (const code of [5, 15]) {
      const fetchMock = vi.fn(async (url: string) => {
        const target = String(url);
        const empty = emptyWallAndConversations(target);
        if (empty) {
          return empty;
        }
        if (target === vkMethodUrl("photos.getAllComments")) {
          return photosUnavailable();
        }
        expect(target).toBe(vkMethodUrl("video.get"));
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

  it("replies to community video comments through video.createComment", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe(vkMethodUrl("video.createComment"));
      const body = String(init?.body ?? "");
      expect(body).toContain("owner_id=-10");
      expect(body).toContain("video_id=20");
      expect(body).toContain("reply_to_comment=4");
      expect(body).toContain("message=Thanks");
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
      externalEventId: "video:-10:20:4",
      target: { externalProfileId: "42", username: null },
    });
    expect(sent.externalMessageId).toBe("99");
  });
});
