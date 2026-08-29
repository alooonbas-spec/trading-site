import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeGraphAfter, encodeGraphReplies } from "@/social/meta/graph-paging";
import { FACEBOOK_GRAPH_ORIGIN } from "@/social/facebook/graph";
import { FacebookAdapter } from "@/social/facebook/adapter";
import { facebookCommentReplyUrl } from "@/social/facebook/inbox";
import { InstagramAdapter } from "@/social/instagram/adapter";
import { INSTAGRAM_GRAPH_ORIGIN } from "@/social/instagram/publish";

function isFacebookUploadedVideos(target: string): boolean {
  return target.includes("/555/videos") && !target.includes("/555/video_reels");
}

describe("PHASE 74 Graph Facebook Page video reels comments", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("walks the next official Facebook video reels after cursor and keeps older comments", async () => {
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
        target.includes("/555/live_videos") ||
        isFacebookUploadedVideos(target)
      ) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      expect(target).toContain(`${FACEBOOK_GRAPH_ORIGIN}/555/video_reels`);
      expect(decodeURIComponent(target)).toContain("comments.limit(50)");
      expect(decodeURIComponent(target)).toContain("comments.limit(25)");
      expect(target).not.toContain("paging.next");
      if (target.includes("after=reel-2")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "r9002",
                comments: {
                  data: [
                    {
                      id: "old-r-c",
                      message: "older reel comment",
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
              id: "r9001",
              comments: {
                data: [
                  {
                    id: "new-r-c",
                    message: "newer reel comment",
                    from: { id: "800", name: "Commenter" },
                    created_time: "2026-08-21T12:00:00+0000",
                  },
                  {
                    id: "own-r-c",
                    message: "page reply",
                    from: { id: "555", name: "Hub Page" },
                    created_time: "2026-08-21T12:01:00+0000",
                  },
                  {
                    id: "blank-r-c",
                    message: "   ",
                    from: { id: "800", name: "Commenter" },
                    created_time: "2026-08-21T12:02:00+0000",
                  },
                ],
              },
            },
          ],
          paging: { cursors: { after: "reel-2" } },
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
        externalId: "new-r-c",
        externalProfileId: "800",
        username: "Commenter",
        body: "newer reel comment",
        url: "https://www.facebook.com/new-r-c",
        receivedAt: "2026-08-21T12:00:00+0000",
        replyKind: "comment",
      },
    ]);
    expect(first.cursor).toBe(
      `comments:2026-08-21T12:00:00+0000|creplies:done|donethreads:done|livereplies:done|livevideos:done|otherthreads:done|pendingthreads:done|photoreplies:done|photos:done|posts:done|ratingreplies:done|ratings:done|reelreplies:done|reels:${encodeGraphAfter("reel-2")}|replies:done|spamthreads:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done|videoreplies:done|videos:done`,
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/555/video_reels"))).toHaveLength(1);

    const second = await new FacebookAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: first.cursor,
    });
    expect(second.messages.map((item) => item.externalId)).toEqual(["old-r-c"]);
    expect(second.cursor).toBe(
      "comments:2026-08-21T12:00:00+0000|creplies:done|donethreads:done|livereplies:done|livevideos:done|otherthreads:done|pendingthreads:done|photoreplies:done|photos:done|posts:done|ratingreplies:done|ratings:done|reelreplies:done|reels:done|replies:done|spamthreads:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done|videoreplies:done|videos:done",
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/555/video_reels"))).toHaveLength(3);
  });

  it("walks the next official Facebook reel comment after cursor and keeps older comments", async () => {
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
        target.includes("/555/live_videos") ||
        isFacebookUploadedVideos(target)
      ) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (
        target.includes("/555_1/comments") ||
        target.includes("/tag1/comments") ||
        target.includes("/st9001/comments") ||
        target.includes("/v9001/comments") ||
        target.includes("/p9001/comments") ||
        target.includes("/lv9001/comments")
      ) {
        throw new Error(`unexpected feed, tagged, video, photo, or live comments after ${target}`);
      }
      if (target.includes("/r9001/comments")) {
        expect(target).toContain("after=reel-cmt-2");
        expect(target).toContain("limit=50");
        expect(target).not.toContain("paging.next");
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "old-r-c",
                message: "older reel comment",
                from: { id: "800", name: "Commenter" },
                created_time: "2026-08-20T09:00:00+0000",
              },
            ],
          }),
          { status: 200 },
        );
      }
      expect(target).toContain(`${FACEBOOK_GRAPH_ORIGIN}/555/video_reels`);
      expect(decodeURIComponent(target)).toContain("comments.limit(50)");
      expect(target).not.toContain("paging.next");
      expect(target).not.toContain("after=");
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "r9001",
              comments: {
                data: [
                  {
                    id: "new-r-c",
                    message: "newer reel comment",
                    from: { id: "800", name: "Commenter" },
                    created_time: "2026-08-21T12:00:00+0000",
                  },
                ],
                paging: { cursors: { after: "reel-cmt-2" } },
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
    expect(first.messages.map((item) => item.externalId)).toEqual(["new-r-c"]);
    expect(first.cursor).toBe(
      `comments:2026-08-21T12:00:00+0000|creplies:done|donethreads:done|livereplies:done|livevideos:done|otherthreads:done|pendingthreads:done|photoreplies:done|photos:done|posts:done|ratingreplies:done|ratings:done|reelreplies:${encodeGraphReplies({ r9001: "reel-cmt-2" })}|reels:done|replies:done|spamthreads:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done|videoreplies:done|videos:done`,
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/r9001/comments"))).toHaveLength(0);

    const second = await new FacebookAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: first.cursor,
    });
    expect(second.messages.map((item) => item.externalId)).toEqual(["old-r-c"]);
    expect(second.cursor).toBe(
      "comments:2026-08-21T12:00:00+0000|creplies:done|donethreads:done|livereplies:done|livevideos:done|otherthreads:done|pendingthreads:done|photoreplies:done|photos:done|posts:done|ratingreplies:done|ratings:done|reelreplies:done|reels:done|replies:done|spamthreads:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done|videoreplies:done|videos:done",
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/r9001/comments"))).toHaveLength(1);
  });

  it("skips Facebook reel after paging once reels:done and reelreplies:done are stored", async () => {
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
        target.includes("/555/live_videos") ||
        isFacebookUploadedVideos(target)
      ) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (target.includes("/r9001/comments")) {
        throw new Error(`unexpected reel comments after ${target}`);
      }
      expect(target).toContain(`${FACEBOOK_GRAPH_ORIGIN}/555/video_reels`);
      expect(target).not.toContain("after=");
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "r9001",
              comments: {
                data: [
                  {
                    id: "new-r-c",
                    message: "newer reel comment",
                    from: { id: "800", name: "Commenter" },
                    created_time: "2026-08-21T10:00:00+0000",
                  },
                ],
                paging: { cursors: { after: "reel-cmt-2" } },
              },
            },
          ],
          paging: { cursors: { after: "reel-2" } },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new FacebookAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: "comments:2026-08-21T08:00:00+0000|reelreplies:done|reels:done",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["new-r-c"]);
    expect(result.cursor).toBe(
      "comments:2026-08-21T10:00:00+0000|creplies:done|donethreads:done|livereplies:done|livevideos:done|otherthreads:done|pendingthreads:done|photoreplies:done|photos:done|posts:done|ratingreplies:done|ratings:done|reelreplies:done|reels:done|replies:done|spamthreads:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done|videoreplies:done|videos:done",
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/555/video_reels"))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/r9001/comments"))).toHaveLength(0);
  });

  it("does not collect Instagram video reels as a separate Graph edge", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.includes("/video_reels")) {
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
    expect(result.cursor).not.toContain("reels");
    expect(result.cursor).not.toContain("reelreplies");
  });

  it("replies to Facebook reel comments through the existing comment endpoint", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      if (target.startsWith(`${FACEBOOK_GRAPH_ORIGIN}/me/accounts`)) {
        return new Response(
          JSON.stringify({ data: [{ id: "555", name: "Hub Page", access_token: "page-token" }] }),
          { status: 200 },
        );
      }
      expect(target.startsWith(facebookCommentReplyUrl("new-r-c"))).toBe(true);
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
      externalEventId: "new-r-c",
      target: { externalProfileId: "800", username: "Commenter" },
    });
    expect(sent.externalMessageId).toBe("reply-99");
  });
});
