import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeGraphAfter, encodeGraphReplies } from "@/social/meta/graph-paging";
import { FACEBOOK_GRAPH_ORIGIN } from "@/social/facebook/graph";
import { FacebookAdapter } from "@/social/facebook/adapter";
import { facebookCommentReplyUrl } from "@/social/facebook/inbox";
import { InstagramAdapter } from "@/social/instagram/adapter";
import { INSTAGRAM_GRAPH_ORIGIN } from "@/social/instagram/publish";

describe("PHASE 72 Graph Facebook Page photos comments", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("walks the next official Facebook photos after cursor and keeps older comments", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.startsWith(`${FACEBOOK_GRAPH_ORIGIN}/me/accounts`)) {
        return new Response(
          JSON.stringify({ data: [{ id: "555", name: "Hub Page", access_token: "page-token" }] }),
          { status: 200 },
        );
      }
      if (
        target.includes("/555/feed") ||
        target.includes("/555/conversations") ||
        target.includes("/555/tagged") ||
        target.includes("/555/ratings") ||
        target.includes("/555/videos")
      ) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      expect(target).toContain(`${FACEBOOK_GRAPH_ORIGIN}/555/photos`);
      expect(target).toContain("type=uploaded");
      expect(decodeURIComponent(target)).toContain("comments.limit(50)");
      expect(decodeURIComponent(target)).toContain("comments.limit(25)");
      expect(target).not.toContain("paging.next");
      if (target.includes("after=photo-2")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "p9002",
                comments: {
                  data: [
                    {
                      id: "old-p-c",
                      message: "older photo comment",
                      from: { id: "800", name: "Commenter" },
                      created_time: "2026-08-20T09:00:00+0000",
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        );
      }
      expect(target).not.toContain("after=");
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "p9001",
              comments: {
                data: [
                  {
                    id: "new-p-c",
                    message: "newer photo comment",
                    from: { id: "800", name: "Commenter" },
                    created_time: "2026-08-21T12:00:00+0000",
                  },
                  {
                    id: "own-p-c",
                    message: "page reply",
                    from: { id: "555", name: "Hub Page" },
                    created_time: "2026-08-21T12:01:00+0000",
                  },
                  {
                    id: "blank-p-c",
                    message: "   ",
                    from: { id: "800", name: "Commenter" },
                    created_time: "2026-08-21T12:02:00+0000",
                  },
                ],
              },
            },
          ],
          paging: { cursors: { after: "photo-2" } },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await new FacebookAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
    });
    expect(first.messages).toEqual([
      {
        externalId: "new-p-c",
        externalProfileId: "800",
        username: "Commenter",
        body: "newer photo comment",
        url: "https://www.facebook.com/new-p-c",
        receivedAt: "2026-08-21T12:00:00+0000",
        replyKind: "comment",
      },
    ]);
    expect(first.cursor).toBe(
      `comments:2026-08-21T12:00:00+0000|creplies:done|donethreads:done|otherthreads:done|pendingthreads:done|photoreplies:done|photos:${encodeGraphAfter("photo-2")}|posts:done|ratingreplies:done|ratings:done|replies:done|spamthreads:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done|videoreplies:done|videos:done`,
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/555/photos"))).toHaveLength(1);

    const second = await new FacebookAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: first.cursor,
    });
    expect(second.messages.map((item) => item.externalId)).toEqual(["old-p-c"]);
    expect(second.cursor).toBe(
      "comments:2026-08-21T12:00:00+0000|creplies:done|donethreads:done|otherthreads:done|pendingthreads:done|photoreplies:done|photos:done|posts:done|ratingreplies:done|ratings:done|replies:done|spamthreads:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done|videoreplies:done|videos:done",
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/555/photos"))).toHaveLength(3);
  });

  it("walks the next official Facebook photo comment after cursor and keeps older comments", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.startsWith(`${FACEBOOK_GRAPH_ORIGIN}/me/accounts`)) {
        return new Response(
          JSON.stringify({ data: [{ id: "555", name: "Hub Page", access_token: "page-token" }] }),
          { status: 200 },
        );
      }
      if (
        target.includes("/555/feed") ||
        target.includes("/555/conversations") ||
        target.includes("/555/tagged") ||
        target.includes("/555/ratings") ||
        target.includes("/555/videos")
      ) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (target.includes("/555_1/comments") || target.includes("/tag1/comments") || target.includes("/st9001/comments")) {
        throw new Error(`unexpected feed or tagged comments after ${target}`);
      }
      if (target.includes("/p9001/comments")) {
        expect(target).toContain("after=photo-cmt-2");
        expect(target).toContain("limit=50");
        expect(target).not.toContain("paging.next");
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "old-p-c",
                message: "older photo comment",
                from: { id: "800", name: "Commenter" },
                created_time: "2026-08-20T09:00:00+0000",
              },
            ],
          }),
          { status: 200 },
        );
      }
      expect(target).toContain(`${FACEBOOK_GRAPH_ORIGIN}/555/photos`);
      expect(decodeURIComponent(target)).toContain("comments.limit(50)");
      expect(target).not.toContain("paging.next");
      expect(target).not.toContain("after=");
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "p9001",
              comments: {
                data: [
                  {
                    id: "new-p-c",
                    message: "newer photo comment",
                    from: { id: "800", name: "Commenter" },
                    created_time: "2026-08-21T12:00:00+0000",
                  },
                ],
                paging: { cursors: { after: "photo-cmt-2" } },
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
    expect(first.messages.map((item) => item.externalId)).toEqual(["new-p-c"]);
    expect(first.cursor).toBe(
      `comments:2026-08-21T12:00:00+0000|creplies:done|donethreads:done|otherthreads:done|pendingthreads:done|photoreplies:${encodeGraphReplies({ p9001: "photo-cmt-2" })}|photos:done|posts:done|ratingreplies:done|ratings:done|replies:done|spamthreads:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done|videoreplies:done|videos:done`,
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/p9001/comments"))).toHaveLength(0);

    const second = await new FacebookAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: first.cursor,
    });
    expect(second.messages.map((item) => item.externalId)).toEqual(["old-p-c"]);
    expect(second.cursor).toBe(
      "comments:2026-08-21T12:00:00+0000|creplies:done|donethreads:done|otherthreads:done|pendingthreads:done|photoreplies:done|photos:done|posts:done|ratingreplies:done|ratings:done|replies:done|spamthreads:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done|videoreplies:done|videos:done",
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/p9001/comments"))).toHaveLength(1);
  });

  it("skips Facebook photo after paging once photos:done and photoreplies:done are stored", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.startsWith(`${FACEBOOK_GRAPH_ORIGIN}/me/accounts`)) {
        return new Response(
          JSON.stringify({ data: [{ id: "555", name: "Hub Page", access_token: "page-token" }] }),
          { status: 200 },
        );
      }
      if (
        target.includes("/555/feed") ||
        target.includes("/555/conversations") ||
        target.includes("/555/tagged") ||
        target.includes("/555/ratings") ||
        target.includes("/555/videos")
      ) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (target.includes("/p9001/comments")) {
        throw new Error(`unexpected photo comments after ${target}`);
      }
      expect(target).toContain(`${FACEBOOK_GRAPH_ORIGIN}/555/photos`);
      expect(target).not.toContain("after=");
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "p9001",
              comments: {
                data: [
                  {
                    id: "new-p-c",
                    message: "newer photo comment",
                    from: { id: "800", name: "Commenter" },
                    created_time: "2026-08-21T10:00:00+0000",
                  },
                ],
                paging: { cursors: { after: "photo-cmt-2" } },
              },
            },
          ],
          paging: { cursors: { after: "photo-2" } },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new FacebookAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor:
        "comments:2026-08-21T08:00:00+0000|photoreplies:done|photos:done",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["new-p-c"]);
    expect(result.cursor).toBe(
      "comments:2026-08-21T10:00:00+0000|creplies:done|donethreads:done|otherthreads:done|pendingthreads:done|photoreplies:done|photos:done|posts:done|ratingreplies:done|ratings:done|replies:done|spamthreads:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done|videoreplies:done|videos:done",
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/555/photos"))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/p9001/comments"))).toHaveLength(0);
  });

  it("does not collect Instagram photos as a separate Graph edge", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.includes("/photos")) {
        throw new Error(`Instagram inbox must not call ${target}`);
      }
      if (target.includes("/ig-1/conversations") || target.includes("/ig-1/tags")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      expect(target).toContain(`${INSTAGRAM_GRAPH_ORIGIN}/ig-1/media`);
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new InstagramAdapter({
      accessToken: "ig-token",
      metadata: { instagramUserId: "ig-1" },
    }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
    });
    expect(result.messages).toEqual([]);
    expect(result.cursor).toBe(
      "creplies:done|posts:done|replies:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done",
    );
    expect(result.cursor).not.toContain("photos");
    expect(result.cursor).not.toContain("photoreplies");
  });

  it("replies to Facebook photo comments through the existing comment endpoint", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      if (target.startsWith(`${FACEBOOK_GRAPH_ORIGIN}/me/accounts`)) {
        return new Response(
          JSON.stringify({ data: [{ id: "555", name: "Hub Page", access_token: "page-token" }] }),
          { status: 200 },
        );
      }
      expect(target.startsWith(facebookCommentReplyUrl("new-p-c"))).toBe(true);
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ message: "Thanks" });
      return new Response(JSON.stringify({ id: "reply-99" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const sent = await new FacebookAdapter({ accessToken: "user-token" }).replyToInbox({
      workspaceId: "w",
      socialAccountId: "a",
      kind: "comment",
      body: "Thanks",
      externalEventId: "new-p-c",
      target: { externalProfileId: "800", username: "Commenter" },
    });
    expect(sent.externalMessageId).toBe("reply-99");
  });
});
