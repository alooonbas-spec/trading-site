import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeGraphAfter } from "@/social/meta/graph-paging";
import { FACEBOOK_GRAPH_ORIGIN, FACEBOOK_SCOPES } from "@/social/facebook/graph";
import { FacebookAdapter } from "@/social/facebook/adapter";
import { facebookCommentReplyUrl } from "@/social/facebook/inbox";
import { InstagramAdapter } from "@/social/instagram/adapter";

describe("PHASE 58 Graph Page ratings after paging", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("still requests pages_read_user_content for Page ratings", () => {
    expect(FACEBOOK_SCOPES).toContain("pages_read_user_content");
  });

  it("walks the next official Facebook ratings after cursor and keeps older reviews", async () => {
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
        target.includes("/555/videos") || target.includes("/555/photos") || target.includes("/555/live_videos") || target.includes("/555/video_reels")
      ) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      expect(target).toContain(`${FACEBOOK_GRAPH_ORIGIN}/555/ratings`);
      expect(decodeURIComponent(target)).toContain("open_graph_story");
      expect(target).not.toContain("paging.next");
      if (target.includes("after=rate-2")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                created_time: "2026-08-20T09:00:00+0000",
                review_text: "older review",
                reviewer: { id: "900", name: "Lead" },
                open_graph_story: { id: "old-story" },
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
              created_time: "2026-08-21T12:00:00+0000",
              review_text: "newer review",
              reviewer: { id: "900", name: "Lead" },
              open_graph_story: { id: "new-story" },
            },
          ],
          paging: { cursors: { after: "rate-2" } },
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
        externalId: "new-story",
        externalProfileId: "900",
        username: "Lead",
        body: "newer review",
        url: "https://www.facebook.com/new-story",
        receivedAt: "2026-08-21T12:00:00+0000",
        replyKind: "comment",
      },
    ]);
    expect(first.cursor).toBe(
      `creplies:done|donethreads:done|livereplies:done|livevideos:done|otherthreads:done|pendingthreads:done|photoreplies:done|photos:done|posts:done|ratingreplies:done|ratings:${encodeGraphAfter("rate-2")}|reelreplies:done|reels:done|replies:done|reviews:2026-08-21T12:00:00+0000|spamthreads:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done|videoreplies:done|videos:done`,
    );

    const second = await new FacebookAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: first.cursor,
    });
    expect(second.messages.map((item) => item.externalId)).toEqual(["old-story"]);
    expect(second.cursor).toBe(
      "creplies:done|donethreads:done|livereplies:done|livevideos:done|otherthreads:done|pendingthreads:done|photoreplies:done|photos:done|posts:done|ratingreplies:done|ratings:done|reelreplies:done|reels:done|replies:done|reviews:2026-08-21T12:00:00+0000|spamthreads:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done|videoreplies:done|videos:done",
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/555/ratings"))).toHaveLength(3);
  });

  it("skips Facebook ratings after paging once ratings:done is stored", async () => {
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
        target.includes("/555/videos") || target.includes("/555/photos") || target.includes("/555/live_videos") || target.includes("/555/video_reels")
      ) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      expect(target).toContain(`${FACEBOOK_GRAPH_ORIGIN}/555/ratings`);
      if (target.includes("after=")) {
        throw new Error(`unexpected ratings after ${target}`);
      }
      return new Response(
        JSON.stringify({
          data: [
            {
              created_time: "2026-08-21T09:00:00+0000",
              review_text: "latest review",
              reviewer: { id: "900", name: "Lead" },
              open_graph_story: { id: "new-story" },
            },
          ],
          paging: { cursors: { after: "rate-2" } },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new FacebookAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: "ratings:done|reviews:2026-08-21T08:00:00+0000",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["new-story"]);
    expect(result.cursor).toBe(
      "creplies:done|donethreads:done|livereplies:done|livevideos:done|otherthreads:done|pendingthreads:done|photoreplies:done|photos:done|posts:done|ratingreplies:done|ratings:done|reelreplies:done|reels:done|replies:done|reviews:2026-08-21T09:00:00+0000|spamthreads:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done|videoreplies:done|videos:done",
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/555/ratings"))).toHaveLength(1);
  });

  it("skips Facebook ratings without a story id, reviewer, or review text", async () => {
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
        target.includes("/555/videos") || target.includes("/555/photos") || target.includes("/555/live_videos") || target.includes("/555/video_reels")
      ) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      expect(target).toContain(`${FACEBOOK_GRAPH_ORIGIN}/555/ratings`);
      return new Response(
        JSON.stringify({
          data: [
            {
              created_time: "2026-08-21T12:00:00+0000",
              review_text: "no story",
              reviewer: { id: "900", name: "Lead" },
            },
            {
              created_time: "2026-08-21T12:00:00+0000",
              review_text: "no reviewer",
              open_graph_story: { id: "story-2" },
            },
            {
              created_time: "2026-08-21T12:00:00+0000",
              reviewer: { id: "900", name: "Lead" },
              open_graph_story: { id: "story-3" },
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
    expect(result.messages).toEqual([]);
    expect(result.cursor).toBe(
      "creplies:done|donethreads:done|livereplies:done|livevideos:done|otherthreads:done|pendingthreads:done|photoreplies:done|photos:done|posts:done|ratingreplies:done|ratings:done|reelreplies:done|reels:done|replies:done|spamthreads:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done|videoreplies:done|videos:done",
    );
  });

  it("replies to Facebook ratings through official story comments", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      if (target.startsWith(`${FACEBOOK_GRAPH_ORIGIN}/me/accounts`)) {
        return new Response(
          JSON.stringify({ data: [{ id: "555", name: "Hub Page", access_token: "page-token" }] }),
          { status: 200 },
        );
      }
      expect(target.startsWith(facebookCommentReplyUrl("new-story"))).toBe(true);
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ message: "Thanks for the review" });
      return new Response(JSON.stringify({ id: "review_reply" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const sent = await new FacebookAdapter({ accessToken: "user-token" }).replyToInbox({
      workspaceId: "w",
      socialAccountId: "a",
      kind: "comment",
      body: "Thanks for the review",
      externalEventId: "new-story",
      target: { externalProfileId: "900", username: "Lead" },
    });
    expect(sent.externalMessageId).toBe("review_reply");
  });

  it("does not call Page ratings from Instagram inbox", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.includes("/ratings")) {
        throw new Error(`unexpected Instagram ratings ${target}`);
      }
      if (target.includes("/ig-1/media") || target.includes("/ig-1/conversations") || target.includes("/ig-1/tags")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      throw new Error(`unexpected Instagram inbox ${target}`);
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
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/ratings"))).toHaveLength(0);
  });
});
