import { afterEach, describe, expect, it, vi } from "vitest";
import { VkAdapter } from "@/social/vk/adapter";
import { vkMethodUrl } from "@/social/vk/api";
import { encodeVkThreadMap } from "@/social/vk/thread-paging";

function nestedReplies(
  startId: number,
  count: number,
  dateStart: number,
): Array<{ id: number; from_id: number; text: string; date: number }> {
  return Array.from({ length: count }, (_, index) => {
    const id = startId - index;
    return {
      id,
      from_id: 42,
      text: `visitor nested ${id}`,
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

describe("PHASE 86 VK nested comments on filter=others posts", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("walks the next official comment_id thread window and keeps older nested visitor-wall replies", async () => {
    const nested = nestedReplies(70, 10, 1710000190);
    const older = nestedReplies(50, 10, 1700000050);
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
          return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
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
      if (body.includes("comment_id=")) {
        expect(body).toContain("comment_id=80");
        expect(body).toContain("post_id=80");
        expect(body).toContain("owner_id=10");
        expect(body).toContain("count=10");
        expect(body).toContain("sort=desc");
        expect(body).not.toContain("thread_items_count=");
        expect(body).toContain("offset=10");
        return new Response(JSON.stringify({ response: { items: older } }), { status: 200 });
      }
      if (body.includes("offset=")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      expect(body).toContain("thread_items_count=10");
      expect(body).toContain("count=50");
      expect(body).not.toContain("comment_id=");
      return new Response(
        JSON.stringify({
          response: {
            items: [
              {
                id: 80,
                from_id: 42,
                text: "parent visitor comment",
                date: 1710000200,
                thread: { count: 20, items: nested },
              },
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
    expect(first.messages.map((item) => item.externalId)).toEqual([
      "otherwall:10:80",
      "otherwall:10:80:80",
      ...nested.map((item) => `otherwall:10:80:${item.id}`),
    ]);
    expect(first.cursor).toBe(
      `mentionpages:1|othercomments:1710000200|others:1710000100|otherwall:1|otherwallcomments:1|otherwallthreads:${encodeVkThreadMap({ "10_80_80": "1" })}|photocomments:1|repostpages:1|userphotocomments:1|userphotos:1|uservideocomments:1|uservideos:1|uservideothreads:done|videocomments:1|videos:1|videothreads:done|wall:1|wallcomments:1|wallthreads:done`,
    );

    const second = await new VkAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: first.cursor,
    });
    expect(second.messages.map((item) => item.externalId)).toEqual(
      older.map((item) => `otherwall:10:80:${item.id}`),
    );
    expect(second.cursor).toBe(
      `mentionpages:done|othercomments:1710000200|others:1710000100|otherwall:done|otherwallcomments:done|otherwallthreads:${encodeVkThreadMap({ "10_80_80": "2" })}|photocomments:done|repostpages:done|userphotocomments:done|userphotos:done|uservideocomments:done|uservideos:done|uservideothreads:done|videocomments:done|videos:done|videothreads:done|wall:done|wallcomments:done|wallthreads:done`,
    );
  });

  it("skips comment_id thread offset once otherwallthreads:done is stored", async () => {
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
              items: [{ id: 80, owner_id: 10, from_id: 42, text: "visitor post", date: 1710000100 }],
            },
          }),
          { status: 200 },
        );
      }
      expect(target).toBe(vkMethodUrl("wall.getComments"));
      if (body.includes("comment_id=")) {
        throw new Error(`unexpected other-wall thread comment_id ${body}`);
      }
      expect(body).toContain("thread_items_count=10");
      return new Response(
        JSON.stringify({
          response: {
            items: [{ id: 81, from_id: 42, text: "newer visitor comment", date: 1710000081 }],
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new VkAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: "othercomments:1710000000|otherwall:done|otherwallthreads:done",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["otherwall:10:80", "otherwall:10:80:81"]);
    expect(result.cursor).toContain("otherwallthreads:done");
  });

  it("stores otherwallthreads for community inbox independently of owner-wall wallthreads", async () => {
    const nested = nestedReplies(70, 10, 1710000190);
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
      expect(body).not.toContain("comment_id=");
      return new Response(
        JSON.stringify({
          response: {
            items: [
              {
                id: 80,
                from_id: 42,
                text: "community parent",
                date: 1710000200,
                thread: { count: 20, items: nested },
              },
            ],
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
    expect(result.messages.map((item) => item.externalId)).toEqual([
      "otherwall:-10:80",
      "otherwall:-10:80:80",
      ...nested.map((item) => `otherwall:-10:80:${item.id}`),
    ]);
    expect(result.cursor).toBe(
      `conversations:1|history:1|othercomments:1710000200|others:1710000100|otherwall:1|otherwallcomments:1|otherwallthreads:${encodeVkThreadMap({ "-10_80_80": "1" })}|repostpages:1|suggestwall:1|wall:1|wallcomments:1|wallthreads:done`,
    );
  });

  it("replies to nested other-wall comments through wall.createComment with reply_to_comment", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe(vkMethodUrl("wall.createComment"));
      const body = String(init?.body ?? "");
      expect(body).toContain("owner_id=10");
      expect(body).toContain("post_id=80");
      expect(body).toContain("reply_to_comment=70");
      expect(body).toContain("message=Thanks");
      return new Response(JSON.stringify({ response: { comment_id: 99 } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const sent = await new VkAdapter({ accessToken: "vk-token" }).replyToInbox({
      workspaceId: "w",
      socialAccountId: "a",
      kind: "comment",
      body: "Thanks",
      externalEventId: "otherwall:10:80:70",
      target: { externalProfileId: "42", username: null },
    });
    expect(sent.externalMessageId).toBe("99");
  });
});
