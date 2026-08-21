import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeGraphReplies } from "@/social/meta/graph-paging";
import { FACEBOOK_GRAPH_ORIGIN } from "@/social/facebook/graph";
import { FacebookAdapter } from "@/social/facebook/adapter";
import { InstagramAdapter } from "@/social/instagram/adapter";
import { INSTAGRAM_GRAPH_ORIGIN } from "@/social/instagram/publish";

describe("PHASE 49 Graph comment-to-comment reply after paging", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("walks the next official Facebook comment replies after cursor and keeps older nested replies", async () => {
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
      if (target.includes("/555/tagged")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (target.includes("/555_1/comments")) {
        throw new Error(`unexpected post comments after ${target}`);
      }
      if (target.includes("/c1/comments")) {
        expect(target).toContain("after=reply-2");
        expect(target).toContain("limit=25");
        expect(target).not.toContain("paging.next");
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "r-old",
                message: "older nested reply",
                from: { id: "801", name: "Replier" },
                created_time: "2026-08-20T09:00:00+0000",
              },
            ],
          }),
          { status: 200 },
        );
      }
      expect(target).toContain(`${FACEBOOK_GRAPH_ORIGIN}/555/feed`);
      expect(decodeURIComponent(target)).toContain("comments.limit(25)");
      expect(target).not.toContain("after=");
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "555_1",
              comments: {
                data: [
                  {
                    id: "c1",
                    message: "parent",
                    from: { id: "800", name: "Commenter" },
                    created_time: "2026-08-21T12:00:00+0000",
                    comments: {
                      data: [
                        {
                          id: "r-new",
                          message: "newer reply",
                          from: { id: "801", name: "Replier" },
                          created_time: "2026-08-21T12:00:00+0000",
                        },
                      ],
                      paging: { cursors: { after: "reply-2" } },
                    },
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

    const first = await new FacebookAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
    });
    expect(first.messages.map((item) => item.externalId)).toEqual(["c1", "r-new"]);
    expect(first.cursor).toBe(
      `comments:2026-08-21T12:00:00+0000|creplies:${encodeGraphReplies({ c1: "reply-2" })}|posts:done|replies:done|tagged:done|threadmsgs:done|threads:done`,
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/c1/comments"))).toHaveLength(0);

    const second = await new FacebookAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: first.cursor,
    });
    expect(second.messages.map((item) => item.externalId)).toEqual(["r-old"]);
    expect(second.cursor).toBe(
      "comments:2026-08-21T12:00:00+0000|creplies:done|posts:done|replies:done|tagged:done|threadmsgs:done|threads:done",
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/c1/comments"))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/555_1/comments"))).toHaveLength(0);
  });

  it("skips Instagram comment reply after paging once creplies:done is stored", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.includes("/ig-1/conversations")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (target.includes("/ig-1/tags")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (target.includes("/c1/replies") || /\/[^/]+\/replies/.test(new URL(target).pathname)) {
        throw new Error(`unexpected comment replies after ${target}`);
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
                    id: "c1",
                    text: "newer",
                    from: { id: "80", username: "fan" },
                    timestamp: "2026-08-21T10:00:00+0000",
                    replies: {
                      data: [],
                      paging: { cursors: { after: "ig-reply-2" } },
                    },
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
      cursor: "comments:2026-08-21T08:00:00+0000|creplies:done|posts:done|replies:done|tagged:done|threadmsgs:done|threads:done",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["c1"]);
    expect(result.cursor).toBe(
      "comments:2026-08-21T10:00:00+0000|creplies:done|posts:done|replies:done|tagged:done|threadmsgs:done|threads:done",
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/c1/replies"))).toHaveLength(0);
  });
});
