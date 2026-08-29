import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthenticationError } from "@/lib/errors";
import { VkAdapter } from "@/social/vk/adapter";
import { isVkMethodUnavailableError, vkMethodUrl } from "@/social/vk/api";

function photoComments(
  startId: number,
  count: number,
  dateStart: number,
  pid = 9,
): Array<{ id: number; pid: number; from_id: number; text: string; date: number }> {
  return Array.from({ length: count }, (_, index) => {
    const id = startId - index;
    return {
      id,
      pid,
      from_id: 42,
      text: `community photo ${id}`,
      date: dateStart - index,
    };
  });
}

const communityMetadata = {
  vkAccountKind: "community",
  vkGroupId: "10",
  publishOwnerId: "-10",
};

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

describe("PHASE 67 VK community photos.getAllComments", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("treats official VK 7 and 27 as unavailable methods", () => {
    expect(
      isVkMethodUnavailableError({
        error: { error_code: 27, error_msg: "Group authorization failed: method is unavailable with group auth" },
      }),
    ).toBe(true);
    expect(isVkMethodUnavailableError({ error: { error_code: 7, error_msg: "Permission to perform this action is denied" } })).toBe(
      true,
    );
    expect(isVkMethodUnavailableError({ error: { error_code: 5, error_msg: "User authorization failed" } })).toBe(false);
    expect(isVkMethodUnavailableError({ error: { error_code: 15, error_msg: "Access denied" } })).toBe(false);
    expect(isVkMethodUnavailableError({ error: { error_code: 17, error_msg: "Validation required" } })).toBe(false);
  });

  it("walks the next official community getAllComments offset window and keeps older photo comments", async () => {
    const older = photoComments(50, 50, 1700000050);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      const empty = emptyWallAndConversations(target);
      if (empty) {
        return empty;
      }
      expect(target).toBe(vkMethodUrl("photos.getAllComments"));
      expect(body).toContain("count=50");
      expect(body).toContain("owner_id=-10");
      expect(body).not.toContain("album_id=");
      if (body.includes("offset=50")) {
        return new Response(JSON.stringify({ response: { items: older } }), { status: 200 });
      }
      expect(body).not.toContain("offset=");
      return new Response(
        JSON.stringify({
          response: {
            items: [
              { id: 80, pid: 9, from_id: 42, text: "newer community photo", date: 1710000200 },
              { id: 79, pid: 9, from_id: 42, text: "   ", date: 1710000199 },
              { id: 78, from_id: 42, text: "missing pid", date: 1710000198 },
              { id: 77, pid: 9, text: "missing from", date: 1710000197 },
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
        externalId: "photo:9:80",
        externalProfileId: "42",
        username: null,
        body: "newer community photo",
        url: "https://vk.com/photo-10_9?reply=80",
        receivedAt: new Date(1710000200 * 1000).toISOString(),
        replyKind: "comment",
      },
    ]);
    expect(first.cursor).toBe(
      "conversations:1|history:1|otherwall:1|otherwallcomments:1|photocomments:1|photos:1710000200|repostpages:1|wall:1|wallcomments:1|wallthreads:done",
    );
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("photos.getAllComments")),
    ).toHaveLength(1);

    const second = await new VkAdapter({
      accessToken: "community-token",
      metadata: communityMetadata,
    }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: first.cursor,
    });
    expect(second.messages.map((item) => item.externalId)).toEqual(older.map((item) => `photo:${item.pid}:${item.id}`));
    expect(second.cursor).toBe(
      "conversations:done|history:done|otherwall:done|otherwallcomments:done|photocomments:2|photos:1710000200|repostpages:done|wall:done|wallcomments:done|wallthreads:done",
    );
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("photos.getAllComments")),
    ).toHaveLength(3);
  });

  it("skips getAllComments offset once photocomments:done is stored", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      const empty = emptyWallAndConversations(target);
      if (empty) {
        return empty;
      }
      expect(target).toBe(vkMethodUrl("photos.getAllComments"));
      expect(body).toContain("owner_id=-10");
      expect(body).not.toContain("offset=");
      return new Response(
        JSON.stringify({
          response: {
            items: [{ id: 80, pid: 9, from_id: 42, text: "newer community photo", date: 1710000200 }],
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
      cursor: "photocomments:done|photos:1710000100",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["photo:9:80"]);
    expect(result.cursor).toBe(
      "conversations:1|history:1|otherwall:1|otherwallcomments:1|photocomments:done|photos:1710000200|repostpages:1|wall:1|wallcomments:1|wallthreads:done",
    );
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("photos.getAllComments")),
    ).toHaveLength(1);
  });

  it("skips community photo comments on VK 7 or 27 without failing wall or Direct Message collection", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      const empty = emptyWallAndConversations(target);
      if (empty) {
        return empty;
      }
      expect(target).toBe(vkMethodUrl("photos.getAllComments"));
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
    expect(result.cursor).toBe("conversations:1|history:1|otherwall:1|otherwallcomments:1|repostpages:1|wall:1|wallcomments:1|wallthreads:done");
    expect(result.cursor).not.toContain("photocomments");
  });

  it("still fails community inbox on VK 5 and 15 from photos.getAllComments", async () => {
    for (const code of [5, 15]) {
      const fetchMock = vi.fn(async (url: string) => {
        const target = String(url);
        const empty = emptyWallAndConversations(target);
        if (empty) {
          return empty;
        }
        expect(target).toBe(vkMethodUrl("photos.getAllComments"));
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

  it("replies to community photo comments with owner_id from the connected group", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe(vkMethodUrl("photos.createComment"));
      const body = String(init?.body ?? "");
      expect(body).toContain("photo_id=9");
      expect(body).toContain("reply_to_comment=4");
      expect(body).toContain("message=Thanks");
      expect(body).toContain("owner_id=-10");
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
      externalEventId: "photo:9:4",
      target: { externalProfileId: "42", username: null },
    });
    expect(sent.externalMessageId).toBe("99");
  });
});
