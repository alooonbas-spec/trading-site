import { afterEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/lib/errors";
import { VkAdapter } from "@/social/vk/adapter";
import { vkMethodUrl } from "@/social/vk/api";
import { parseVkInboxPhotoTagRef } from "@/social/vk/inbox";

function taggedPhotos(
  startId: number,
  count: number,
  dateStart: number,
  ownerId = 77,
): Array<{ id: number; owner_id: number; text: string; date: number }> {
  return Array.from({ length: count }, (_, index) => {
    const id = startId - index;
    return {
      id,
      owner_id: ownerId,
      text: `tagged photo ${id}`,
      date: dateStart - index,
    };
  });
}

describe("PHASE 61 VK photos.getUserPhotos", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses photo tag refs and refuses photo comment ids", () => {
    expect(parseVkInboxPhotoTagRef("phototag:77:20")).toEqual({ ownerId: "77", photoId: "20" });
    expect(parseVkInboxPhotoTagRef("phototag:-100:9")).toEqual({ ownerId: "-100", photoId: "9" });
    expect(() => parseVkInboxPhotoTagRef("photo:9:4")).toThrow(ValidationError);
    expect(() => parseVkInboxPhotoTagRef("phototag:77")).toThrow(ValidationError);
    expect(() => parseVkInboxPhotoTagRef("phototag:abc:20")).toThrow(ValidationError);
  });

  it("walks the next official getUserPhotos offset window and keeps older tagged photos", async () => {
    const older = taggedPhotos(20, 20, 1700000020);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      if (target === vkMethodUrl("wall.get") || target === vkMethodUrl("wall.getComments")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("newsfeed.getMentions")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("photos.getAllComments") || target === vkMethodUrl("photos.getComments")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("video.get") || target === vkMethodUrl("video.getComments")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      expect(target).toBe(vkMethodUrl("photos.getUserPhotos"));
      expect(body).toContain("count=20");
      expect(body).not.toContain("user_id=");
      if (body.includes("offset=20")) {
        return new Response(JSON.stringify({ response: { items: older } }), { status: 200 });
      }
      expect(body).not.toContain("offset=");
      return new Response(
        JSON.stringify({
          response: {
            items: [
              { id: 80, owner_id: 77, text: "newer tagged photo", date: 1710000200 },
              { id: 79, owner_id: 77, text: "   ", date: 1710000199 },
              { id: 78, text: "missing owner", date: 1710000198 },
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
        externalId: "phototag:77:80",
        externalProfileId: "77",
        username: null,
        body: "newer tagged photo",
        url: "https://vk.com/photo77_80",
        receivedAt: new Date(1710000200 * 1000).toISOString(),
        replyKind: "mention",
      },
    ]);
    expect(first.cursor).toBe(
      "mentionpages:1|photocomments:1|phototags:1710000200|userphotocomments:1|userphotos:1|videocomments:1|videos:1|videothreads:done|wall:1|wallcomments:1|wallthreads:done",
    );
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("photos.getUserPhotos")),
    ).toHaveLength(1);

    const second = await new VkAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: first.cursor,
    });
    expect(second.messages.map((item) => item.externalId)).toEqual(older.map((item) => `phototag:77:${item.id}`));
    expect(second.cursor).toBe(
      "mentionpages:done|photocomments:done|phototags:1710000200|userphotocomments:done|userphotos:2|videocomments:done|videos:done|videothreads:done|wall:done|wallcomments:done|wallthreads:done",
    );
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("photos.getUserPhotos")),
    ).toHaveLength(3);
  });

  it("skips getUserPhotos offset once userphotos:done is stored", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      if (target === vkMethodUrl("wall.get") || target === vkMethodUrl("wall.getComments")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("newsfeed.getMentions") || target === vkMethodUrl("photos.getAllComments") || target === vkMethodUrl("photos.getComments")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("video.get") || target === vkMethodUrl("video.getComments")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      expect(target).toBe(vkMethodUrl("photos.getUserPhotos"));
      if (body.includes("offset=")) {
        throw new Error(`unexpected user photos offset ${body}`);
      }
      return new Response(
        JSON.stringify({
          response: {
            items: [{ id: 81, owner_id: 77, text: "newer tagged photo", date: 1710000081 }],
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new VkAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: "phototags:1710000000|userphotos:done",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["phototag:77:81"]);
    expect(result.cursor).toBe(
      "mentionpages:1|photocomments:1|phototags:1710000081|userphotocomments:1|userphotos:done|videocomments:1|videos:1|videothreads:done|wall:1|wallcomments:1|wallthreads:done",
    );
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("photos.getUserPhotos")),
    ).toHaveLength(1);
  });

  it("does not call photos.getUserPhotos for community inbox", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target === vkMethodUrl("photos.getUserPhotos") || target === vkMethodUrl("photos.getComments")) {
        throw new Error("community inbox must not call photos.getUserPhotos");
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
      fetchMock.mock.calls.some(([url]) => String(url) === vkMethodUrl("photos.getUserPhotos")),
    ).toBe(false);
  });

  it("replies to VK photo tags through photos.createComment on the source photo", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe(vkMethodUrl("photos.createComment"));
      const body = String(init?.body ?? "");
      expect(body).toContain("owner_id=77");
      expect(body).toContain("photo_id=80");
      expect(body).toContain("message=Thanks");
      expect(body).not.toContain("reply_to_comment=");
      return new Response(JSON.stringify({ response: 99 }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const sent = await new VkAdapter({ accessToken: "vk-token" }).replyToInbox({
      workspaceId: "w",
      socialAccountId: "a",
      kind: "mention",
      body: "Thanks",
      externalEventId: "phototag:77:80",
      target: { externalProfileId: "77", username: null },
    });
    expect(sent.externalMessageId).toBe("99");
  });
});
