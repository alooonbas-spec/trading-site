import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeGraphReplies } from "@/social/meta/graph-paging";
import { FACEBOOK_GRAPH_ORIGIN } from "@/social/facebook/graph";
import { FacebookAdapter } from "@/social/facebook/adapter";
import { facebookCommentReplyUrl } from "@/social/facebook/inbox";

describe("PHASE 59 Graph comments on Facebook rating stories", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("walks the next official Facebook rating-story comment after cursor and keeps older comments", async () => {
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
        target.includes("/555/videos") || target.includes("/555/photos") || target.includes("/555/live_videos") || target.includes("/555/video_reels") || target.includes("/555/albums")
      ) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (target.includes("/555_1/comments") || target.includes("/tag1/comments")) {
        throw new Error(`unexpected feed or tagged comments after ${target}`);
      }
      if (target.includes("/st9001/comments")) {
        expect(target).toContain("after=rate-cmt-2");
        expect(target).toContain("limit=50");
        expect(target).not.toContain("paging.next");
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "old-rate-c",
                message: "older rating comment",
                from: { id: "800", name: "Commenter" },
                created_time: "2026-08-20T09:00:00+0000",
              },
            ],
          }),
          { status: 200 },
        );
      }
      expect(target).toContain(`${FACEBOOK_GRAPH_ORIGIN}/555/ratings`);
      expect(decodeURIComponent(target)).toContain("comments.limit(50)");
      expect(target).not.toContain("after=");
      return new Response(
        JSON.stringify({
          data: [
            {
              created_time: "2026-08-21T12:00:00+0000",
              review_text: "newer review",
              reviewer: { id: "900", name: "Lead" },
              open_graph_story: {
                id: "st9001",
                comments: {
                  data: [
                    {
                      id: "new-rate-c",
                      message: "newer rating comment",
                      from: { id: "800", name: "Commenter" },
                      created_time: "2026-08-21T12:00:00+0000",
                    },
                  ],
                  paging: { cursors: { after: "rate-cmt-2" } },
                },
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
    expect(first.messages.map((item) => item.externalId)).toEqual(["new-rate-c", "st9001"]);
    expect(first.messages[0]).toMatchObject({
      body: "newer rating comment",
      replyKind: "comment",
    });
    expect(first.cursor).toBe(
      `albumreplies:done|albums:done|comments:2026-08-21T12:00:00+0000|creplies:done|donethreads:done|livereplies:done|livevideos:done|otherthreads:done|pendingthreads:done|photoreplies:done|photos:done|posts:done|ratingreplies:${encodeGraphReplies({ st9001: "rate-cmt-2" })}|ratings:done|reelreplies:done|reels:done|replies:done|reviews:2026-08-21T12:00:00+0000|spamthreads:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done|videoreplies:done|videos:done`,
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/st9001/comments"))).toHaveLength(0);

    const second = await new FacebookAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: first.cursor,
    });
    expect(second.messages.map((item) => item.externalId)).toEqual(["old-rate-c"]);
    expect(second.cursor).toBe(
      "albumreplies:done|albums:done|comments:2026-08-21T12:00:00+0000|creplies:done|donethreads:done|livereplies:done|livevideos:done|otherthreads:done|pendingthreads:done|photoreplies:done|photos:done|posts:done|ratingreplies:done|ratings:done|reelreplies:done|reels:done|replies:done|reviews:2026-08-21T12:00:00+0000|spamthreads:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done|videoreplies:done|videos:done",
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/st9001/comments"))).toHaveLength(1);
  });

  it("skips Facebook rating-story comments after paging once ratingreplies:done is stored", async () => {
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
        target.includes("/555/videos") || target.includes("/555/photos") || target.includes("/555/live_videos") || target.includes("/555/video_reels") || target.includes("/555/albums")
      ) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (target.includes("/st9001/comments")) {
        throw new Error(`unexpected rating comments after ${target}`);
      }
      expect(target).toContain(`${FACEBOOK_GRAPH_ORIGIN}/555/ratings`);
      return new Response(
        JSON.stringify({
          data: [
            {
              created_time: "2026-08-21T09:00:00+0000",
              review_text: "latest review",
              reviewer: { id: "900", name: "Lead" },
              open_graph_story: {
                id: "st9001",
                comments: {
                  data: [
                    {
                      id: "new-rate-c",
                      message: "newer rating comment",
                      from: { id: "800", name: "Commenter" },
                      created_time: "2026-08-21T10:00:00+0000",
                    },
                  ],
                  paging: { cursors: { after: "rate-cmt-2" } },
                },
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
      cursor: "comments:2026-08-21T08:00:00+0000|ratingreplies:done|ratings:done",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["new-rate-c", "st9001"]);
    expect(result.cursor).toBe(
      "albumreplies:done|albums:done|comments:2026-08-21T10:00:00+0000|creplies:done|donethreads:done|livereplies:done|livevideos:done|otherthreads:done|pendingthreads:done|photoreplies:done|photos:done|posts:done|ratingreplies:done|ratings:done|reelreplies:done|reels:done|replies:done|reviews:2026-08-21T09:00:00+0000|spamthreads:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done|videoreplies:done|videos:done",
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/st9001/comments"))).toHaveLength(0);
  });

  it("collects comments on Facebook ratings that have a story id even without review text", async () => {
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
        target.includes("/555/videos") || target.includes("/555/photos") || target.includes("/555/live_videos") || target.includes("/555/video_reels") || target.includes("/555/albums")
      ) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      expect(target).toContain(`${FACEBOOK_GRAPH_ORIGIN}/555/ratings`);
      return new Response(
        JSON.stringify({
          data: [
            {
              created_time: "2026-08-21T12:00:00+0000",
              reviewer: { id: "900", name: "Lead" },
              open_graph_story: {
                id: "st9001",
                comments: {
                  data: [
                    {
                      id: "rate-c",
                      message: "comment on a star-only rating",
                      from: { id: "800", name: "Commenter" },
                      created_time: "2026-08-21T12:00:00+0000",
                    },
                  ],
                },
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
        externalId: "rate-c",
        externalProfileId: "800",
        username: "Commenter",
        body: "comment on a star-only rating",
        url: "https://www.facebook.com/rate-c",
        receivedAt: "2026-08-21T12:00:00+0000",
        replyKind: "comment",
      },
    ]);
    expect(result.cursor).toBe(
      "albumreplies:done|albums:done|comments:2026-08-21T12:00:00+0000|creplies:done|donethreads:done|livereplies:done|livevideos:done|otherthreads:done|pendingthreads:done|photoreplies:done|photos:done|posts:done|ratingreplies:done|ratings:done|reelreplies:done|reels:done|replies:done|spamthreads:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done|videoreplies:done|videos:done",
    );
  });

  it("replies to Facebook rating-story comments through official comment replies", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      if (target.startsWith(`${FACEBOOK_GRAPH_ORIGIN}/me/accounts`)) {
        return new Response(
          JSON.stringify({ data: [{ id: "555", name: "Hub Page", access_token: "page-token" }] }),
          { status: 200 },
        );
      }
      expect(target.startsWith(facebookCommentReplyUrl("new-rate-c"))).toBe(true);
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ message: "Thanks" });
      return new Response(JSON.stringify({ id: "rate_c_reply" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const sent = await new FacebookAdapter({ accessToken: "user-token" }).replyToInbox({
      workspaceId: "w",
      socialAccountId: "a",
      kind: "comment",
      body: "Thanks",
      externalEventId: "new-rate-c",
      target: { externalProfileId: "800", username: "Commenter" },
    });
    expect(sent.externalMessageId).toBe("rate_c_reply");
  });
});
