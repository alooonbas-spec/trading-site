import { afterEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/lib/errors";
import { VkAdapter } from "@/social/vk/adapter";
import { vkMethodUrl } from "@/social/vk/api";
import { parseVkInboxPhotoCommentRef } from "@/social/vk/inbox";

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
      text: `photo comment ${id}`,
      date: dateStart - index,
    };
  });
}

describe("PHASE 52 VK photos.getAllComments", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses photo comment refs and refuses wall comment ids", () => {
    expect(parseVkInboxPhotoCommentRef("photo:9:4")).toEqual({ photoId: "9", commentId: "4" });
    expect(parseVkInboxPhotoCommentRef("photo:12:80")).toEqual({ photoId: "12", commentId: "80" });
    expect(() => parseVkInboxPhotoCommentRef("10:20:30")).toThrow(ValidationError);
    expect(() => parseVkInboxPhotoCommentRef("photo:abc:4")).toThrow(ValidationError);
    expect(() => parseVkInboxPhotoCommentRef("photo:9")).toThrow(ValidationError);
  });

  it("walks the next official getAllComments offset window and keeps older photo comments", async () => {
    const older = photoComments(50, 50, 1700000050);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      if (target === vkMethodUrl("wall.get") || target === vkMethodUrl("wall.getComments")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("newsfeed.getMentions")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("video.get") || target === vkMethodUrl("video.getComments")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      expect(target).toBe(vkMethodUrl("photos.getAllComments"));
      expect(body).toContain("count=50");
      expect(body).not.toContain("album_id=");
      expect(body).not.toContain("owner_id=");
      if (body.includes("offset=50")) {
        return new Response(JSON.stringify({ response: { items: older } }), { status: 200 });
      }
      expect(body).not.toContain("offset=");
      return new Response(
        JSON.stringify({
          response: {
            items: [
              { id: 80, pid: 9, from_id: 42, text: "newer photo", date: 1710000200 },
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

    const first = await new VkAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
    });
    expect(first.messages).toEqual([
      {
        externalId: "photo:9:80",
        externalProfileId: "42",
        username: null,
        body: "newer photo",
        url: null,
        receivedAt: new Date(1710000200 * 1000).toISOString(),
        replyKind: "comment",
      },
    ]);
    expect(first.cursor).toBe("mentionpages:1|photocomments:1|photos:1710000200|videocomments:1|videos:1|wall:1|wallcomments:1");
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("photos.getAllComments")),
    ).toHaveLength(1);

    const second = await new VkAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: first.cursor,
    });
    expect(second.messages.map((item) => item.externalId)).toEqual(older.map((item) => `photo:${item.pid}:${item.id}`));
    expect(second.cursor).toBe("mentionpages:done|photocomments:2|photos:1710000200|videocomments:done|videos:done|wall:done|wallcomments:done");
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("photos.getAllComments")),
    ).toHaveLength(3);
  });

  it("skips getAllComments offset once photocomments:done is stored", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      if (target === vkMethodUrl("wall.get") || target === vkMethodUrl("wall.getComments")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("newsfeed.getMentions")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("video.get") || target === vkMethodUrl("video.getComments")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      expect(target).toBe(vkMethodUrl("photos.getAllComments"));
      if (body.includes("offset=")) {
        throw new Error(`unexpected photo comments offset ${body}`);
      }
      expect(body).toContain("count=50");
      return new Response(
        JSON.stringify({
          response: {
            items: [{ id: 81, pid: 9, from_id: 42, text: "newer photo", date: 1710000081 }],
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new VkAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: "photocomments:done|photos:1710000000",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["photo:9:81"]);
    expect(result.cursor).toBe("mentionpages:1|photocomments:done|photos:1710000081|videocomments:1|videos:1|wall:1|wallcomments:1");
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("photos.getAllComments")),
    ).toHaveLength(1);
  });

  it("does not call photos.getAllComments for community inbox", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target === vkMethodUrl("photos.getAllComments")) {
        throw new Error("community inbox must not call photos.getAllComments");
      }
      if (target === vkMethodUrl("wall.get") || target === vkMethodUrl("wall.getComments")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("messages.getConversations")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
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
      fetchMock.mock.calls.some(([url]) => String(url) === vkMethodUrl("photos.getAllComments")),
    ).toBe(false);
  });

  it("replies to VK photo comments through photos.createComment", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe(vkMethodUrl("photos.createComment"));
      const body = String(init?.body ?? "");
      expect(body).toContain("photo_id=9");
      expect(body).toContain("reply_to_comment=4");
      expect(body).toContain("message=Thanks");
      expect(body).not.toContain("owner_id=");
      return new Response(JSON.stringify({ response: 99 }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const sent = await new VkAdapter({ accessToken: "vk-token" }).replyToInbox({
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
