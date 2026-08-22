import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeGraphReplies } from "@/social/meta/graph-paging";
import { FACEBOOK_GRAPH_ORIGIN } from "@/social/facebook/graph";
import { FacebookAdapter } from "@/social/facebook/adapter";

describe("PHASE 60 Graph nested replies on Facebook rating-story comments", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("walks the next official Facebook rating-comment replies after cursor and keeps older nested replies", async () => {
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
        target.includes("/555/tagged")
      ) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (target.includes("/555_1/comments") || target.includes("/tag1/comments") || target.includes("/st9001/comments")) {
        throw new Error(`unexpected feed, tagged, or rating-story comments after ${target}`);
      }
      if (target.includes("/ratec1/comments")) {
        expect(target).toContain("after=rate-reply-2");
        expect(target).toContain("limit=25");
        expect(target).not.toContain("paging.next");
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "rater-old",
                message: "older rating nested reply",
                from: { id: "801", name: "Replier" },
                created_time: "2026-08-20T09:00:00+0000",
              },
            ],
          }),
          { status: 200 },
        );
      }
      expect(target).toContain(`${FACEBOOK_GRAPH_ORIGIN}/555/ratings`);
      expect(decodeURIComponent(target)).toContain("comments.limit(25)");
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
                      id: "ratec1",
                      message: "parent on rating story",
                      from: { id: "800", name: "Commenter" },
                      created_time: "2026-08-21T12:00:00+0000",
                      comments: {
                        data: [
                          {
                            id: "rater-new",
                            message: "newer rating nested reply",
                            from: { id: "801", name: "Replier" },
                            created_time: "2026-08-21T12:00:00+0000",
                          },
                        ],
                        paging: { cursors: { after: "rate-reply-2" } },
                      },
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

    const first = await new FacebookAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
    });
    expect(first.messages.map((item) => item.externalId)).toEqual(["ratec1", "rater-new", "st9001"]);
    expect(first.messages[1]).toMatchObject({
      body: "newer rating nested reply",
      replyKind: "comment",
    });
    expect(first.cursor).toBe(
      `comments:2026-08-21T12:00:00+0000|creplies:${encodeGraphReplies({ ratec1: "rate-reply-2" })}|otherthreads:done|posts:done|ratingreplies:done|ratings:done|replies:done|reviews:2026-08-21T12:00:00+0000|tagged:done|taggedreplies:done|threadmsgs:done|threads:done`,
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/ratec1/comments"))).toHaveLength(0);

    const second = await new FacebookAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: first.cursor,
    });
    expect(second.messages.map((item) => item.externalId)).toEqual(["rater-old"]);
    expect(second.cursor).toBe(
      "comments:2026-08-21T12:00:00+0000|creplies:done|otherthreads:done|posts:done|ratingreplies:done|ratings:done|replies:done|reviews:2026-08-21T12:00:00+0000|tagged:done|taggedreplies:done|threadmsgs:done|threads:done",
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/ratec1/comments"))).toHaveLength(1);
  });

  it("skips Facebook rating-comment replies after paging once creplies:done is stored", async () => {
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
        target.includes("/555/tagged")
      ) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (target.includes("/ratec1/comments")) {
        throw new Error(`unexpected rating comment replies after ${target}`);
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
                      id: "ratec1",
                      message: "parent on rating story",
                      from: { id: "800", name: "Commenter" },
                      created_time: "2026-08-21T10:00:00+0000",
                      comments: {
                        data: [
                          {
                            id: "rater-new",
                            message: "newer rating nested reply",
                            from: { id: "801", name: "Replier" },
                            created_time: "2026-08-21T10:00:00+0000",
                          },
                        ],
                        paging: { cursors: { after: "rate-reply-2" } },
                      },
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
      cursor: "comments:2026-08-21T08:00:00+0000|creplies:done|ratingreplies:done|ratings:done",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["ratec1", "rater-new", "st9001"]);
    expect(result.cursor).toBe(
      "comments:2026-08-21T10:00:00+0000|creplies:done|otherthreads:done|posts:done|ratingreplies:done|ratings:done|replies:done|reviews:2026-08-21T09:00:00+0000|tagged:done|taggedreplies:done|threadmsgs:done|threads:done",
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/ratec1/comments"))).toHaveLength(0);
  });
});
