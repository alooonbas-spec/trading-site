import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeGraphAfter } from "@/social/meta/graph-paging";
import { FACEBOOK_GRAPH_ORIGIN } from "@/social/facebook/graph";
import { FacebookAdapter } from "@/social/facebook/adapter";
import { InstagramAdapter } from "@/social/instagram/adapter";
import { INSTAGRAM_GRAPH_ORIGIN } from "@/social/instagram/publish";

describe("PHASE 63 Graph Facebook conversations folder=other", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("walks the next official Other-folder after cursor and keeps older DMs", async () => {
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
        target.includes("/555/tagged") ||
        target.includes("/555/ratings") ||
        target.includes("/555/videos") || target.includes("/555/photos") || target.includes("/555/live_videos") || target.includes("/555/video_reels")
      ) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      expect(target).toContain(`${FACEBOOK_GRAPH_ORIGIN}/555/conversations`);
      expect(target).toContain("platform=MESSENGER");
      if (target.includes("folder=") && !target.includes("folder=other")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (!target.includes("folder=other")) {
        expect(target).not.toContain("folder=");
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (target.includes("after=other-2")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                messages: {
                  data: [
                    {
                      id: "old-other-m",
                      message: "older other folder",
                      from: { id: "900", name: "Lead" },
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
              messages: {
                data: [
                  {
                    id: "new-other-m",
                    message: "newer other folder",
                    from: { id: "900", name: "Lead" },
                    created_time: "2026-08-21T12:00:00+0000",
                  },
                ],
              },
            },
          ],
          paging: { cursors: { after: "other-2" } },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await new FacebookAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
    });
    expect(first.messages.map((item) => item.externalId)).toEqual(["new-other-m"]);
    expect(first.cursor).toBe(
      `creplies:done|donethreads:done|livereplies:done|livevideos:done|messages:2026-08-21T12:00:00+0000|otherthreads:${encodeGraphAfter("other-2")}|pendingthreads:done|photoreplies:done|photos:done|posts:done|ratingreplies:done|ratings:done|reelreplies:done|reels:done|replies:done|spamthreads:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done|videoreplies:done|videos:done`,
    );

    const second = await new FacebookAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: first.cursor,
    });
    expect(second.messages.map((item) => item.externalId)).toEqual(["old-other-m"]);
    expect(second.cursor).toBe(
      "creplies:done|donethreads:done|livereplies:done|livevideos:done|messages:2026-08-21T12:00:00+0000|otherthreads:done|pendingthreads:done|photoreplies:done|photos:done|posts:done|ratingreplies:done|ratings:done|reelreplies:done|reels:done|replies:done|spamthreads:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done|videoreplies:done|videos:done",
    );
    expect(
      fetchMock.mock.calls.filter(
        ([url]) => String(url).includes("/555/conversations") && String(url).includes("folder=other"),
      ),
    ).toHaveLength(3);
  });

  it("skips Other-folder after paging once otherthreads:done is stored", async () => {
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
        target.includes("/555/tagged") ||
        target.includes("/555/ratings") ||
        target.includes("/555/videos") || target.includes("/555/photos") || target.includes("/555/live_videos") || target.includes("/555/video_reels")
      ) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      expect(target).toContain(`${FACEBOOK_GRAPH_ORIGIN}/555/conversations`);
      if (target.includes("folder=page_done")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (!target.includes("folder=other")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (target.includes("after=")) {
        throw new Error(`unexpected Other-folder after ${target}`);
      }
      return new Response(
        JSON.stringify({
          data: [
            {
              messages: {
                data: [
                  {
                    id: "new-other-m",
                    message: "newer other folder",
                    from: { id: "900", name: "Lead" },
                    created_time: "2026-08-21T09:00:00+0000",
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
      cursor: "messages:2026-08-21T08:00:00+0000|otherthreads:done|threads:done",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["new-other-m"]);
    expect(result.cursor).toBe(
      "creplies:done|donethreads:done|livereplies:done|livevideos:done|messages:2026-08-21T09:00:00+0000|otherthreads:done|pendingthreads:done|photoreplies:done|photos:done|posts:done|ratingreplies:done|ratings:done|reelreplies:done|reels:done|replies:done|spamthreads:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done|videoreplies:done|videos:done",
    );
    expect(
      fetchMock.mock.calls.filter(
        ([url]) => String(url).includes("/555/conversations") && String(url).includes("folder=other"),
      ),
    ).toHaveLength(1);
  });

  it("does not request folder=other for Instagram inbox", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.includes("folder=other")) {
        throw new Error("Instagram inbox must not request folder=other");
      }
      if (target.includes("/ig-1/media") || target.includes("/ig-1/tags")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      expect(target).toContain(`${INSTAGRAM_GRAPH_ORIGIN}/ig-1/conversations`);
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
    expect(result.cursor).toBe(
      "creplies:done|posts:done|replies:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done",
    );
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("folder=other"))).toBe(false);
  });
});
