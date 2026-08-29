import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeGraphAfter, encodeGraphReplies } from "@/social/meta/graph-paging";
import { FACEBOOK_GRAPH_ORIGIN } from "@/social/facebook/graph";
import { FacebookAdapter } from "@/social/facebook/adapter";
import { facebookCommentReplyUrl } from "@/social/facebook/inbox";
import { InstagramAdapter } from "@/social/instagram/adapter";
import { INSTAGRAM_GRAPH_ORIGIN } from "@/social/instagram/publish";

describe("PHASE 73 Graph Facebook Page live videos comments", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("walks the next official Facebook live videos after cursor and keeps older comments", async () => {
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
        target.includes("/555/photos") ||
        target.includes("/555/videos") ||
        target.includes("/555/video_reels") || target.includes("/555/albums")
      ) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      expect(target).toContain(`${FACEBOOK_GRAPH_ORIGIN}/555/live_videos`);
      expect(decodeURIComponent(target)).toContain("comments.limit(50)");
      expect(decodeURIComponent(target)).toContain("comments.limit(25)");
      expect(target).not.toContain("paging.next");
      if (target.includes("after=live-2")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "lv9002",
                comments: {
                  data: [
                    {
                      id: "old-lv-c",
                      message: "older live comment",
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
              id: "lv9001",
              comments: {
                data: [
                  {
                    id: "new-lv-c",
                    message: "newer live comment",
                    from: { id: "800", name: "Commenter" },
                    created_time: "2026-08-21T12:00:00+0000",
                  },
                  {
                    id: "own-lv-c",
                    message: "page reply",
                    from: { id: "555", name: "Hub Page" },
                    created_time: "2026-08-21T12:01:00+0000",
                  },
                  {
                    id: "blank-lv-c",
                    message: "   ",
                    from: { id: "800", name: "Commenter" },
                    created_time: "2026-08-21T12:02:00+0000",
                  },
                ],
              },
            },
          ],
          paging: { cursors: { after: "live-2" } },
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
        externalId: "new-lv-c",
        externalProfileId: "800",
        username: "Commenter",
        body: "newer live comment",
        url: "https://www.facebook.com/new-lv-c",
        receivedAt: "2026-08-21T12:00:00+0000",
        replyKind: "comment",
      },
    ]);
    expect(first.cursor).toBe(
      `albumreplies:done|albums:done|comments:2026-08-21T12:00:00+0000|creplies:done|donethreads:done|livereplies:done|livevideos:${encodeGraphAfter("live-2")}|otherthreads:done|pendingthreads:done|photoreplies:done|photos:done|posts:done|ratingreplies:done|ratings:done|reelreplies:done|reels:done|replies:done|spamthreads:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done|videoreplies:done|videos:done`,
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/555/live_videos"))).toHaveLength(1);

    const second = await new FacebookAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: first.cursor,
    });
    expect(second.messages.map((item) => item.externalId)).toEqual(["old-lv-c"]);
    expect(second.cursor).toBe(
      "albumreplies:done|albums:done|comments:2026-08-21T12:00:00+0000|creplies:done|donethreads:done|livereplies:done|livevideos:done|otherthreads:done|pendingthreads:done|photoreplies:done|photos:done|posts:done|ratingreplies:done|ratings:done|reelreplies:done|reels:done|replies:done|spamthreads:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done|videoreplies:done|videos:done",
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/555/live_videos"))).toHaveLength(3);
  });

  it("walks the next official Facebook live video comment after cursor and keeps older comments", async () => {
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
        target.includes("/555/photos") ||
        target.includes("/555/videos") ||
        target.includes("/555/video_reels") || target.includes("/555/albums")
      ) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (
        target.includes("/555_1/comments") ||
        target.includes("/tag1/comments") ||
        target.includes("/st9001/comments") ||
        target.includes("/v9001/comments") ||
        target.includes("/p9001/comments")
      ) {
        throw new Error(`unexpected feed, tagged, video, or photo comments after ${target}`);
      }
      if (target.includes("/lv9001/comments")) {
        expect(target).toContain("after=live-cmt-2");
        expect(target).toContain("limit=50");
        expect(target).not.toContain("paging.next");
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "old-lv-c",
                message: "older live comment",
                from: { id: "800", name: "Commenter" },
                created_time: "2026-08-20T09:00:00+0000",
              },
            ],
          }),
          { status: 200 },
        );
      }
      expect(target).toContain(`${FACEBOOK_GRAPH_ORIGIN}/555/live_videos`);
      expect(decodeURIComponent(target)).toContain("comments.limit(50)");
      expect(target).not.toContain("paging.next");
      expect(target).not.toContain("after=");
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "lv9001",
              comments: {
                data: [
                  {
                    id: "new-lv-c",
                    message: "newer live comment",
                    from: { id: "800", name: "Commenter" },
                    created_time: "2026-08-21T12:00:00+0000",
                  },
                ],
                paging: { cursors: { after: "live-cmt-2" } },
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
    expect(first.messages.map((item) => item.externalId)).toEqual(["new-lv-c"]);
    expect(first.cursor).toBe(
      `albumreplies:done|albums:done|comments:2026-08-21T12:00:00+0000|creplies:done|donethreads:done|livereplies:${encodeGraphReplies({ lv9001: "live-cmt-2" })}|livevideos:done|otherthreads:done|pendingthreads:done|photoreplies:done|photos:done|posts:done|ratingreplies:done|ratings:done|reelreplies:done|reels:done|replies:done|spamthreads:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done|videoreplies:done|videos:done`,
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/lv9001/comments"))).toHaveLength(0);

    const second = await new FacebookAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: first.cursor,
    });
    expect(second.messages.map((item) => item.externalId)).toEqual(["old-lv-c"]);
    expect(second.cursor).toBe(
      "albumreplies:done|albums:done|comments:2026-08-21T12:00:00+0000|creplies:done|donethreads:done|livereplies:done|livevideos:done|otherthreads:done|pendingthreads:done|photoreplies:done|photos:done|posts:done|ratingreplies:done|ratings:done|reelreplies:done|reels:done|replies:done|spamthreads:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done|videoreplies:done|videos:done",
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/lv9001/comments"))).toHaveLength(1);
  });

  it("skips Facebook live video after paging once livevideos:done and livereplies:done are stored", async () => {
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
        target.includes("/555/photos") ||
        target.includes("/555/videos") ||
        target.includes("/555/video_reels") || target.includes("/555/albums")
      ) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (target.includes("/lv9001/comments")) {
        throw new Error(`unexpected live video comments after ${target}`);
      }
      expect(target).toContain(`${FACEBOOK_GRAPH_ORIGIN}/555/live_videos`);
      expect(target).not.toContain("after=");
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "lv9001",
              comments: {
                data: [
                  {
                    id: "new-lv-c",
                    message: "newer live comment",
                    from: { id: "800", name: "Commenter" },
                    created_time: "2026-08-21T10:00:00+0000",
                  },
                ],
                paging: { cursors: { after: "live-cmt-2" } },
              },
            },
          ],
          paging: { cursors: { after: "live-2" } },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new FacebookAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: "comments:2026-08-21T08:00:00+0000|livereplies:done|livevideos:done",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["new-lv-c"]);
    expect(result.cursor).toBe(
      "albumreplies:done|albums:done|comments:2026-08-21T10:00:00+0000|creplies:done|donethreads:done|livereplies:done|livevideos:done|otherthreads:done|pendingthreads:done|photoreplies:done|photos:done|posts:done|ratingreplies:done|ratings:done|reelreplies:done|reels:done|replies:done|spamthreads:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done|videoreplies:done|videos:done",
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/555/live_videos"))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/lv9001/comments"))).toHaveLength(0);
  });

  it("does not collect Instagram live videos as a separate Graph edge", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.includes("/live_videos")) {
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
    expect(result.cursor).not.toContain("livevideos");
    expect(result.cursor).not.toContain("livereplies");
  });

  it("replies to Facebook live video comments through the existing comment endpoint", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      if (target.startsWith(`${FACEBOOK_GRAPH_ORIGIN}/me/accounts`)) {
        return new Response(
          JSON.stringify({ data: [{ id: "555", name: "Hub Page", access_token: "page-token" }] }),
          { status: 200 },
        );
      }
      expect(target.startsWith(facebookCommentReplyUrl("new-lv-c"))).toBe(true);
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
      externalEventId: "new-lv-c",
      target: { externalProfileId: "800", username: "Commenter" },
    });
    expect(sent.externalMessageId).toBe("reply-99");
  });
});
