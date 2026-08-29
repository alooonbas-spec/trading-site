import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeGraphAfter } from "@/social/meta/graph-paging";
import { FACEBOOK_GRAPH_ORIGIN } from "@/social/facebook/graph";
import { FacebookAdapter } from "@/social/facebook/adapter";
import { InstagramAdapter } from "@/social/instagram/adapter";
import { INSTAGRAM_GRAPH_ORIGIN } from "@/social/instagram/publish";

describe("PHASE 43 Graph feed and media after paging", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("walks the next official Facebook feed after cursor and keeps older comments", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.startsWith(`${FACEBOOK_GRAPH_ORIGIN}/me/accounts`)) {
        return new Response(
          JSON.stringify({ data: [{ id: "555", name: "Hub Page", access_token: "page-token" }] }),
          { status: 200 },
        );
      }
      if (target.includes("/555/conversations")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (target.includes("/555/tagged") || target.includes("/555/ratings") || target.includes("/555/videos") || target.includes("/555/photos") || target.includes("/555/live_videos") || target.includes("/555/video_reels")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      expect(target).toContain(`${FACEBOOK_GRAPH_ORIGIN}/555/feed`);
      if (target.includes("after=feed-2")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "555_old",
                comments: {
                  data: [
                    {
                      id: "old-c",
                      message: "older post comment",
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
              id: "555_new",
              comments: {
                data: [
                  {
                    id: "new-c",
                    message: "newer",
                    from: { id: "800", name: "Commenter" },
                    created_time: "2026-08-21T12:00:00+0000",
                  },
                ],
              },
            },
          ],
          paging: { cursors: { after: "feed-2" } },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await new FacebookAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
    });
    expect(first.messages.map((item) => item.externalId)).toEqual(["new-c"]);
    expect(first.cursor).toBe(
      `comments:2026-08-21T12:00:00+0000|creplies:done|donethreads:done|livereplies:done|livevideos:done|otherthreads:done|pendingthreads:done|photoreplies:done|photos:done|posts:${encodeGraphAfter("feed-2")}|ratingreplies:done|ratings:done|reelreplies:done|reels:done|replies:done|spamthreads:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done|videoreplies:done|videos:done`,
    );

    const second = await new FacebookAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: first.cursor,
    });
    expect(second.messages.map((item) => item.externalId)).toEqual(["old-c"]);
    expect(second.cursor).toBe("comments:2026-08-21T12:00:00+0000|creplies:done|donethreads:done|livereplies:done|livevideos:done|otherthreads:done|pendingthreads:done|photoreplies:done|photos:done|posts:done|ratingreplies:done|ratings:done|reelreplies:done|reels:done|replies:done|spamthreads:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done|videoreplies:done|videos:done");
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/555/feed"))).toHaveLength(3);
  });

  it("skips Instagram media after paging once posts:done is stored", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.includes("/ig-1/conversations")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (target.includes("/ig-1/tags")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      expect(target).toContain(`${INSTAGRAM_GRAPH_ORIGIN}/ig-1/media`);
      if (target.includes("after=")) {
        throw new Error(`unexpected media after ${target}`);
      }
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "media-1",
              comments: {
                data: [
                  {
                    id: "new-c",
                    text: "newer",
                    from: { id: "80", username: "fan" },
                    timestamp: "2026-08-21T10:00:00+0000",
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

    const result = await new InstagramAdapter({
      accessToken: "ig-token",
      metadata: { instagramUserId: "ig-1" },
    }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: "comments:2026-08-21T08:00:00+0000|creplies:done|posts:done|threads:done",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["new-c"]);
    expect(result.cursor).toBe("comments:2026-08-21T10:00:00+0000|creplies:done|posts:done|replies:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done");
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/ig-1/media"))).toHaveLength(1);
  });
});
