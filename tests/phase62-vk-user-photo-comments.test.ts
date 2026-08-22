import { afterEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/lib/errors";
import { VkAdapter } from "@/social/vk/adapter";
import { vkMethodUrl } from "@/social/vk/api";
import { parseVkInboxPhotoTagCommentRef } from "@/social/vk/inbox";

function photoComments(
  startId: number,
  count: number,
  dateStart: number,
): Array<{ id: number; from_id: number; text: string; date: number }> {
  return Array.from({ length: count }, (_, index) => {
    const id = startId - index;
    return {
      id,
      from_id: 42,
      text: `tagged photo comment ${id}`,
      date: dateStart - index,
    };
  });
}

describe("PHASE 62 VK photos.getComments on tagged photos", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses tagged photo comment refs and refuses mention or album comment ids", () => {
    expect(parseVkInboxPhotoTagCommentRef("phototag:77:20:4")).toEqual({
      ownerId: "77",
      photoId: "20",
      commentId: "4",
    });
    expect(parseVkInboxPhotoTagCommentRef("phototag:-100:9:80")).toEqual({
      ownerId: "-100",
      photoId: "9",
      commentId: "80",
    });
    expect(() => parseVkInboxPhotoTagCommentRef("phototag:77:20")).toThrow(ValidationError);
    expect(() => parseVkInboxPhotoTagCommentRef("photo:9:4")).toThrow(ValidationError);
    expect(() => parseVkInboxPhotoTagCommentRef("phototag:abc:20:4")).toThrow(ValidationError);
  });

  it("walks the next official getComments offset window and keeps older tagged-photo comments", async () => {
    const older = photoComments(50, 50, 1700000050);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      if (
        target === vkMethodUrl("wall.get") ||
        target === vkMethodUrl("wall.getComments") ||
        target === vkMethodUrl("newsfeed.getMentions") ||
        target === vkMethodUrl("photos.getAllComments")
      ) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("video.get") || target === vkMethodUrl("video.getComments")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("photos.getUserPhotos")) {
        expect(body).not.toContain("offset=");
        return new Response(
          JSON.stringify({ response: { items: [{ id: 20, owner_id: 77, text: "tagged", date: 1710000100 }] } }),
          { status: 200 },
        );
      }
      expect(target).toBe(vkMethodUrl("photos.getComments"));
      expect(body).toContain("count=50");
      expect(body).toContain("sort=desc");
      expect(body).toContain("owner_id=77");
      expect(body).toContain("photo_id=20");
      if (body.includes("offset=50")) {
        return new Response(JSON.stringify({ response: { items: older } }), { status: 200 });
      }
      expect(body).not.toContain("offset=");
      return new Response(
        JSON.stringify({
          response: {
            items: [
              { id: 80, from_id: 42, text: "newer tagged photo comment", date: 1710000200 },
              { id: 79, from_id: 42, text: "   ", date: 1710000199 },
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
      cursor: "userphotocomments:1|userphotos:done",
    });
    expect(first.messages).toEqual([
      {
        externalId: "phototag:77:20",
        externalProfileId: "77",
        username: null,
        body: "tagged",
        url: "https://vk.com/photo77_20",
        receivedAt: new Date(1710000100 * 1000).toISOString(),
        replyKind: "mention",
      },
      {
        externalId: "phototag:77:20:80",
        externalProfileId: "42",
        username: null,
        body: "newer tagged photo comment",
        url: "https://vk.com/photo77_20?reply=80",
        receivedAt: new Date(1710000200 * 1000).toISOString(),
        replyKind: "comment",
      },
      ...older.map((item) => ({
        externalId: `phototag:77:20:${item.id}`,
        externalProfileId: "42",
        username: null,
        body: item.text,
        url: `https://vk.com/photo77_20?reply=${item.id}`,
        receivedAt: new Date(item.date * 1000).toISOString(),
        replyKind: "comment",
      })),
    ]);
    expect(first.cursor).toBe(
      "mentionpages:1|photocomments:1|phototags:1710000100|userphoto:1710000200|userphotocomments:2|userphotos:done|videocomments:1|videos:1|videothreads:done|wall:1|wallcomments:1|wallthreads:done",
    );
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("photos.getComments")),
    ).toHaveLength(2);
  });

  it("collects comments on tagged photos that have no caption text", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (
        target === vkMethodUrl("wall.get") ||
        target === vkMethodUrl("wall.getComments") ||
        target === vkMethodUrl("newsfeed.getMentions") ||
        target === vkMethodUrl("photos.getAllComments") ||
        target === vkMethodUrl("video.get") ||
        target === vkMethodUrl("video.getComments") ||
        target === vkMethodUrl("board.getTopics") ||
        target === vkMethodUrl("board.getComments")
      ) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("photos.getUserPhotos")) {
        return new Response(
          JSON.stringify({
            response: {
              items: [{ id: 20, owner_id: 77, date: 1710000100 }],
            },
          }),
          { status: 200 },
        );
      }
      expect(target).toBe(vkMethodUrl("photos.getComments"));
      return new Response(
        JSON.stringify({
          response: {
            items: [{ id: 4, from_id: 42, text: "comment on a photo-only tag", date: 1710000200 }],
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
        externalId: "phototag:77:20:4",
        externalProfileId: "42",
        username: null,
        body: "comment on a photo-only tag",
        url: "https://vk.com/photo77_20?reply=4",
        receivedAt: new Date(1710000200 * 1000).toISOString(),
        replyKind: "comment",
      },
    ]);
    expect(result.cursor).toBe(
      "mentionpages:1|photocomments:1|userphoto:1710000200|userphotocomments:1|userphotos:1|videocomments:1|videos:1|videothreads:done|wall:1|wallcomments:1|wallthreads:done",
    );
  });

  it("skips getComments offset once userphotocomments:done is stored", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      if (
        target === vkMethodUrl("wall.get") ||
        target === vkMethodUrl("wall.getComments") ||
        target === vkMethodUrl("newsfeed.getMentions") ||
        target === vkMethodUrl("photos.getAllComments") ||
        target === vkMethodUrl("video.get") ||
        target === vkMethodUrl("video.getComments") ||
        target === vkMethodUrl("board.getTopics") ||
        target === vkMethodUrl("board.getComments")
      ) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("photos.getUserPhotos")) {
        return new Response(
          JSON.stringify({ response: { items: [{ id: 20, owner_id: 77, text: "tagged", date: 1710000100 }] } }),
          { status: 200 },
        );
      }
      expect(target).toBe(vkMethodUrl("photos.getComments"));
      if (body.includes("offset=")) {
        throw new Error(`unexpected tagged photo comments offset ${body}`);
      }
      return new Response(
        JSON.stringify({
          response: {
            items: [{ id: 81, from_id: 42, text: "newer tagged photo comment", date: 1710000081 }],
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new VkAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: "userphoto:1710000000|userphotocomments:done|userphotos:done",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["phototag:77:20", "phototag:77:20:81"]);
    expect(result.cursor).toBe(
      "mentionpages:1|photocomments:1|phototags:1710000100|userphoto:1710000081|userphotocomments:done|userphotos:done|videocomments:1|videos:1|videothreads:done|wall:1|wallcomments:1|wallthreads:done",
    );
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("photos.getComments")),
    ).toHaveLength(1);
  });

  it("does not call photos.getComments for community inbox", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target === vkMethodUrl("photos.getComments") || target === vkMethodUrl("photos.getUserPhotos")) {
        throw new Error("community inbox must not call photos.getComments");
      }
      if (target === vkMethodUrl("wall.get") || target === vkMethodUrl("wall.getComments")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("messages.getConversations")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (
        target === vkMethodUrl("photos.getAllComments") ||
        target === vkMethodUrl("video.get") ||
        target === vkMethodUrl("video.getComments") ||
        target === vkMethodUrl("board.getTopics") ||
        target === vkMethodUrl("board.getComments")
      ) {
        return new Response(
          JSON.stringify({
            error: { error_code: 27, error_msg: "Group authorization failed: method is unavailable with group auth" },
          }),
          { status: 200 },
        );
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
      fetchMock.mock.calls.some(([url]) => String(url) === vkMethodUrl("photos.getComments")),
    ).toBe(false);
  });

  it("replies to tagged photo comments through photos.createComment", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe(vkMethodUrl("photos.createComment"));
      const body = String(init?.body ?? "");
      expect(body).toContain("owner_id=77");
      expect(body).toContain("photo_id=20");
      expect(body).toContain("reply_to_comment=4");
      expect(body).toContain("message=Thanks");
      return new Response(JSON.stringify({ response: 99 }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const sent = await new VkAdapter({ accessToken: "vk-token" }).replyToInbox({
      workspaceId: "w",
      socialAccountId: "a",
      kind: "comment",
      body: "Thanks",
      externalEventId: "phototag:77:20:4",
      target: { externalProfileId: "42", username: null },
    });
    expect(sent.externalMessageId).toBe("99");
  });
});
