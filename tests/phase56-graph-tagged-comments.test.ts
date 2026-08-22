import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeGraphReplies } from "@/social/meta/graph-paging";
import { FACEBOOK_GRAPH_ORIGIN } from "@/social/facebook/graph";
import { FacebookAdapter } from "@/social/facebook/adapter";
import { facebookCommentReplyUrl } from "@/social/facebook/inbox";
import { InstagramAdapter } from "@/social/instagram/adapter";
import { INSTAGRAM_GRAPH_ORIGIN } from "@/social/instagram/publish";
import { instagramCommentReplyUrl } from "@/social/instagram/inbox";

describe("PHASE 56 Graph comments on tagged posts and media", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("walks the next official Facebook tagged post comment after cursor and keeps older comments", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.startsWith(`${FACEBOOK_GRAPH_ORIGIN}/me/accounts`)) {
        return new Response(
          JSON.stringify({ data: [{ id: "555", name: "Hub Page", access_token: "page-token" }] }),
          { status: 200 },
        );
      }
      if (target.includes("/555/feed") || target.includes("/555/conversations")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (target.includes("/555/ratings")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (target.includes("/555_1/comments")) {
        throw new Error(`unexpected feed comments after ${target}`);
      }
      if (target.includes("/tag1/comments")) {
        expect(target).toContain("after=tag-cmt-2");
        expect(target).toContain("limit=50");
        expect(target).not.toContain("paging.next");
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "old-tag-c",
                message: "older tagged comment",
                from: { id: "800", name: "Commenter" },
                created_time: "2026-08-20T09:00:00+0000",
              },
            ],
          }),
          { status: 200 },
        );
      }
      expect(target).toContain(`${FACEBOOK_GRAPH_ORIGIN}/555/tagged`);
      expect(decodeURIComponent(target)).toContain("comments.limit(50)");
      expect(target).not.toContain("paging.next");
      expect(target).not.toContain("after=");
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "tag1",
              message: "tagged the page",
              from: { id: "900", name: "Lead" },
              created_time: "2026-08-21T12:00:00+0000",
              permalink_url: "https://www.facebook.com/tag1",
              comments: {
                data: [
                  {
                    id: "new-tag-c",
                    message: "newer tagged comment",
                    from: { id: "800", name: "Commenter" },
                    created_time: "2026-08-21T12:00:00+0000",
                  },
                ],
                paging: { cursors: { after: "tag-cmt-2" } },
              },
            },
          ],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await new FacebookAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
    });
    expect(first.messages.map((item) => item.externalId)).toEqual(["new-tag-c", "tag1"]);
    expect(first.messages[0]).toMatchObject({
      body: "newer tagged comment",
      replyKind: "comment",
    });
    expect(first.cursor).toBe(
      `comments:2026-08-21T12:00:00+0000|creplies:done|donethreads:done|mentions:2026-08-21T12:00:00+0000|otherthreads:done|pendingthreads:done|posts:done|ratingreplies:done|ratings:done|replies:done|tagged:done|taggedreplies:${encodeGraphReplies({ tag1: "tag-cmt-2" })}|threadmsgs:done|threads:done`,
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/tag1/comments"))).toHaveLength(0);

    const second = await new FacebookAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: first.cursor,
    });
    expect(second.messages.map((item) => item.externalId)).toEqual(["old-tag-c"]);
    expect(second.cursor).toBe(
      "comments:2026-08-21T12:00:00+0000|creplies:done|donethreads:done|mentions:2026-08-21T12:00:00+0000|otherthreads:done|pendingthreads:done|posts:done|ratingreplies:done|ratings:done|replies:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done",
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/tag1/comments"))).toHaveLength(1);
  });

  it("skips Instagram tagged media comment after paging once taggedreplies:done is stored", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.includes("/ig-1/media") || target.includes("/ig-1/conversations")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (target.includes("/igtag1/comments") || target.includes("/media-1/comments")) {
        throw new Error(`unexpected tagged comment after ${target}`);
      }
      expect(target).toContain(`${INSTAGRAM_GRAPH_ORIGIN}/ig-1/tags`);
      expect(decodeURIComponent(target)).toContain("comments.limit(50)");
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "igtag1",
              caption: "tagged you",
              username: "lead",
              timestamp: "2026-08-21T09:00:00+0000",
              permalink: "https://www.instagram.com/p/igtag1/",
              comments: {
                data: [
                  {
                    id: "new-tag-c",
                    text: "newer tagged comment",
                    from: { id: "80", username: "fan" },
                    timestamp: "2026-08-21T10:00:00+0000",
                  },
                ],
                paging: { cursors: { after: "ig-tag-cmt-2" } },
              },
            },
          ],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new InstagramAdapter({
      accessToken: "ig-token",
      metadata: { instagramUserId: "ig-1" },
    }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor:
        "comments:2026-08-21T08:00:00+0000|creplies:done|posts:done|replies:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["new-tag-c", "igtag1"]);
    expect(result.cursor).toBe(
      "comments:2026-08-21T10:00:00+0000|creplies:done|mentions:2026-08-21T09:00:00+0000|posts:done|replies:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done",
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/igtag1/comments"))).toHaveLength(0);
  });

  it("collects comments on photo-only Facebook tagged posts without inventing a mention", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.startsWith(`${FACEBOOK_GRAPH_ORIGIN}/me/accounts`)) {
        return new Response(
          JSON.stringify({ data: [{ id: "555", name: "Hub Page", access_token: "page-token" }] }),
          { status: 200 },
        );
      }
      if (target.includes("/555/feed") || target.includes("/555/conversations")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (target.includes("/555/ratings")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      expect(target).toContain(`${FACEBOOK_GRAPH_ORIGIN}/555/tagged`);
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "photo-tag",
              from: { id: "900", name: "Lead" },
              created_time: "2026-08-21T12:00:00+0000",
              comments: {
                data: [
                  {
                    id: "photo-c",
                    message: "nice photo",
                    from: { id: "800", name: "Commenter" },
                    created_time: "2026-08-21T12:00:00+0000",
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new FacebookAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
    });
    expect(result.messages).toEqual([
      {
        externalId: "photo-c",
        externalProfileId: "800",
        username: "Commenter",
        body: "nice photo",
        url: "https://www.facebook.com/photo-c",
        receivedAt: "2026-08-21T12:00:00+0000",
        replyKind: "comment",
      },
    ]);
    expect(result.cursor).toBe(
      "comments:2026-08-21T12:00:00+0000|creplies:done|donethreads:done|otherthreads:done|pendingthreads:done|posts:done|ratingreplies:done|ratings:done|replies:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done",
    );
  });

  it("replies to Facebook tagged-post comments through official comment replies", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      if (target.startsWith(`${FACEBOOK_GRAPH_ORIGIN}/me/accounts`)) {
        return new Response(
          JSON.stringify({ data: [{ id: "555", name: "Hub Page", access_token: "page-token" }] }),
          { status: 200 },
        );
      }
      expect(target.startsWith(facebookCommentReplyUrl("new-tag-c"))).toBe(true);
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ message: "Thanks" });
      return new Response(JSON.stringify({ id: "tag_c_reply" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const sent = await new FacebookAdapter({ accessToken: "user-token" }).replyToInbox({
      workspaceId: "w",
      socialAccountId: "a",
      kind: "comment",
      body: "Thanks",
      externalEventId: "new-tag-c",
      target: { externalProfileId: "800", username: "Commenter" },
    });
    expect(sent.externalMessageId).toBe("tag_c_reply");
  });

  it("replies to Instagram tagged-media comments through official comment replies", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url).startsWith(instagramCommentReplyUrl("new-tag-c"))).toBe(true);
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ message: "Thanks" });
      return new Response(JSON.stringify({ id: "ig_tag_c_reply" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const sent = await new InstagramAdapter({
      accessToken: "ig-token",
      metadata: { instagramUserId: "ig-1" },
    }).replyToInbox({
      workspaceId: "w",
      socialAccountId: "a",
      kind: "comment",
      body: "Thanks",
      externalEventId: "new-tag-c",
      target: { externalProfileId: "80", username: "@fan" },
    });
    expect(sent.externalMessageId).toBe("ig_tag_c_reply");
  });
});
