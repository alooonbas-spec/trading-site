import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decodeGraphReplies,
  encodeGraphAfter,
  encodeGraphReplies,
  GRAPH_REPLIES_FETCH_LIMIT,
  nextGraphRepliesCursor,
} from "@/social/meta/graph-paging";
import { FACEBOOK_GRAPH_ORIGIN } from "@/social/facebook/graph";
import { FacebookAdapter } from "@/social/facebook/adapter";
import { InstagramAdapter } from "@/social/instagram/adapter";
import { INSTAGRAM_GRAPH_ORIGIN } from "@/social/instagram/publish";

describe("Graph nested comment replies helpers", () => {
  it("encodes and decodes a per-object after map, and stays done once stored", () => {
    const encoded = encodeGraphReplies({ "555_1": "cmt-2", media1: "ig-2" });
    expect(encoded).toBe(encodeGraphAfter(JSON.stringify({ "555_1": "cmt-2", media1: "ig-2" })));
    expect(decodeGraphReplies(encoded)).toEqual({ "555_1": "cmt-2", media1: "ig-2" });
    expect(encodeGraphReplies({})).toBe("done");
    expect(decodeGraphReplies("done")).toBeNull();
    expect(
      nextGraphRepliesCursor({
        stored: "done",
        nestedAfters: { "555_1": "cmt-2" },
        fetchedNextAfters: {},
        fetchedIds: [],
      }),
    ).toBe("done");
    const many: Record<string, string> = {};
    for (let index = 0; index < GRAPH_REPLIES_FETCH_LIMIT + 5; index += 1) {
      many[`id${String(index).padStart(2, "0")}`] = `after-${index}`;
    }
    expect(Object.keys(decodeGraphReplies(encodeGraphReplies(many)) ?? {})).toHaveLength(
      GRAPH_REPLIES_FETCH_LIMIT,
    );
  });
});

describe("PHASE 44 Graph nested comment after paging", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("walks the next official Facebook comment after cursor and keeps older comments", async () => {
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
      if (target.includes("/555/tagged") || target.includes("/555/ratings") || target.includes("/555/videos") || target.includes("/555/photos") || target.includes("/555/live_videos") || target.includes("/555/video_reels") || target.includes("/555/albums")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (target.includes("/555_1/comments")) {
        expect(target).toContain("after=cmt-2");
        expect(target).not.toContain("paging.next");
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "old-c",
                message: "older nested comment",
                from: { id: "800", name: "Commenter" },
                created_time: "2026-08-20T09:00:00+0000",
              },
            ],
          }),
          { status: 200 },
        );
      }
      expect(target).toContain(`${FACEBOOK_GRAPH_ORIGIN}/555/feed`);
      expect(target).not.toContain("after=");
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "555_1",
              comments: {
                data: [
                  {
                    id: "new-c",
                    message: "newer",
                    from: { id: "800", name: "Commenter" },
                    created_time: "2026-08-21T12:00:00+0000",
                  },
                ],
                paging: { cursors: { after: "cmt-2" } },
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
    expect(first.messages.map((item) => item.externalId)).toEqual(["new-c"]);
    expect(first.cursor).toBe(
      `albumreplies:done|albums:done|comments:2026-08-21T12:00:00+0000|creplies:done|donethreads:done|livereplies:done|livevideos:done|otherthreads:done|pendingthreads:done|photoreplies:done|photos:done|posts:done|ratingreplies:done|ratings:done|reelreplies:done|reels:done|replies:${encodeGraphReplies({ "555_1": "cmt-2" })}|spamthreads:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done|videoreplies:done|videos:done`,
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/555_1/comments"))).toHaveLength(0);

    const second = await new FacebookAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: first.cursor,
    });
    expect(second.messages.map((item) => item.externalId)).toEqual(["old-c"]);
    expect(second.cursor).toBe(
      "albumreplies:done|albums:done|comments:2026-08-21T12:00:00+0000|creplies:done|donethreads:done|livereplies:done|livevideos:done|otherthreads:done|pendingthreads:done|photoreplies:done|photos:done|posts:done|ratingreplies:done|ratings:done|reelreplies:done|reels:done|replies:done|spamthreads:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done|videoreplies:done|videos:done",
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/555_1/comments"))).toHaveLength(1);
  });

  it("skips Instagram comment after paging once replies:done is stored", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.includes("/ig-1/conversations")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (target.includes("/ig-1/tags")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (target.includes("/media-1/comments")) {
        throw new Error(`unexpected comment after ${target}`);
      }
      expect(target).toContain(`${INSTAGRAM_GRAPH_ORIGIN}/ig-1/media`);
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
                paging: { cursors: { after: "ig-cmt-2" } },
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
      cursor: "comments:2026-08-21T08:00:00+0000|creplies:done|posts:done|replies:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["new-c"]);
    expect(result.cursor).toBe(
      "comments:2026-08-21T10:00:00+0000|creplies:done|posts:done|replies:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done",
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/media-1/comments"))).toHaveLength(0);
  });
});
