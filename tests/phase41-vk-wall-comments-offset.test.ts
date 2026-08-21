import { afterEach, describe, expect, it, vi } from "vitest";
import { VkAdapter } from "@/social/vk/adapter";
import { vkMethodUrl } from "@/social/vk/api";
import { parseVkInboxCursor } from "@/social/vk/inbox";

function commentItems(
  startId: number,
  count: number,
  dateStart: number,
): Array<{ id: number; from_id: number; text: string; date: number }> {
  return Array.from({ length: count }, (_, index) => {
    const id = startId - index;
    return {
      id,
      from_id: 42,
      text: `comment ${id}`,
      date: dateStart - index,
    };
  });
}

describe("VK wall comment offset cursor", () => {
  it("parses wallcomments pages and the done marker", () => {
    expect(parseVkInboxCursor("comments:1|wall:done|wallcomments:2")).toEqual({
      comments: "1",
      messages: null,
      history: false,
      historyPage: 0,
      conversations: false,
      conversationsPage: 0,
      wall: true,
      wallPage: "done",
      wallcomments: true,
      wallcommentsPage: 2,
    });
    expect(parseVkInboxCursor("comments:1|wall:done|wallcomments:done")).toEqual({
      comments: "1",
      messages: null,
      history: false,
      historyPage: 0,
      conversations: false,
      conversationsPage: 0,
      wall: true,
      wallPage: "done",
      wallcomments: true,
      wallcommentsPage: "done",
    });
  });
});

describe("PHASE 41 VK wall.getComments offset", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("walks the next official getComments offset window after wallcomments:1", async () => {
    const older = commentItems(50, 50, 1700000050);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      if (target === vkMethodUrl("wall.get")) {
        expect(body).not.toContain("offset=");
        return new Response(
          JSON.stringify({ response: { items: [{ id: 20, owner_id: 10 }] } }),
          { status: 200 },
        );
      }
      if (target === vkMethodUrl("newsfeed.getMentions")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("photos.getAllComments")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("video.get") || target === vkMethodUrl("video.getComments")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      expect(target).toBe(vkMethodUrl("wall.getComments"));
      expect(body).toContain("count=50");
      expect(body).toContain("sort=desc");
      if (body.includes("offset=50")) {
        return new Response(JSON.stringify({ response: { items: older } }), { status: 200 });
      }
      expect(body).not.toContain("offset=");
      return new Response(
        JSON.stringify({
          response: {
            items: [{ id: 80, from_id: 42, text: "newer", date: 1710000200 }],
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new VkAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: "comments:1710000000|wall:done|wallcomments:1|wallthreads:done",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual([
      "10:20:80",
      ...older.map((item) => `10:20:${item.id}`),
    ]);
    expect(result.cursor).toBe("comments:1710000200|mentionpages:1|photocomments:1|videocomments:1|videos:1|wall:done|wallcomments:2|wallthreads:done");
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("wall.getComments")),
    ).toHaveLength(2);
  });

  it("stores wallcomments:done when the older getComments window is short", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      if (target === vkMethodUrl("wall.get")) {
        return new Response(
          JSON.stringify({ response: { items: [{ id: 20, owner_id: 10 }] } }),
          { status: 200 },
        );
      }
      if (target === vkMethodUrl("newsfeed.getMentions")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("photos.getAllComments")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("video.get") || target === vkMethodUrl("video.getComments")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      expect(target).toBe(vkMethodUrl("wall.getComments"));
      if (body.includes("offset=50")) {
        return new Response(
          JSON.stringify({
            response: {
              items: [{ id: 1, from_id: 42, text: "oldest", date: 1700000000 }],
            },
          }),
          { status: 200 },
        );
      }
      expect(body).not.toContain("offset=");
      return new Response(
        JSON.stringify({
          response: {
            items: [{ id: 80, from_id: 42, text: "newer", date: 1710000200 }],
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new VkAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: "comments:1710000000|wall:done|wallcomments:1|wallthreads:done",
    });
    expect(result.messages.map((item) => item.externalId).sort()).toEqual(["10:20:1", "10:20:80"]);
    expect(result.cursor).toBe("comments:1710000200|mentionpages:1|photocomments:1|videocomments:1|videos:1|wall:done|wallcomments:done|wallthreads:done");
  });

  it("skips getComments offset after wallcomments:done", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      if (target === vkMethodUrl("wall.get")) {
        return new Response(
          JSON.stringify({ response: { items: [{ id: 20, owner_id: 10 }] } }),
          { status: 200 },
        );
      }
      if (target === vkMethodUrl("newsfeed.getMentions")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("photos.getAllComments")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("video.get") || target === vkMethodUrl("video.getComments")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      expect(target).toBe(vkMethodUrl("wall.getComments"));
      if (body.includes("offset=")) {
        throw new Error(`unexpected comment offset ${body}`);
      }
      expect(body).toContain("count=50");
      return new Response(
        JSON.stringify({
          response: {
            items: [{ id: 81, from_id: 42, text: "newer", date: 1710000081 }],
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new VkAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: "comments:1710000000|wall:done|wallcomments:done|wallthreads:done",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["10:20:81"]);
    expect(result.cursor).toBe("comments:1710000081|mentionpages:1|photocomments:1|videocomments:1|videos:1|wall:done|wallcomments:done|wallthreads:done");
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("wall.getComments")),
    ).toHaveLength(1);
  });
});
