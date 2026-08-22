import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeGraphReplies } from "@/social/meta/graph-paging";
import { FACEBOOK_GRAPH_ORIGIN } from "@/social/facebook/graph";
import { FacebookAdapter } from "@/social/facebook/adapter";
import { InstagramAdapter } from "@/social/instagram/adapter";
import { INSTAGRAM_GRAPH_ORIGIN } from "@/social/instagram/publish";

describe("PHASE 57 Graph nested replies on tagged comments", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("walks the next official Facebook tagged-comment replies after cursor and keeps older nested replies", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.startsWith(`${FACEBOOK_GRAPH_ORIGIN}/me/accounts`)) {
        return new Response(
          JSON.stringify({ data: [{ id: "555", name: "Hub Page", access_token: "page-token" }] }),
          { status: 200 },
        );
      }
      if (target.includes("/555/feed") || target.includes("/555/conversations")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (target.includes("/555/ratings")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (target.includes("/555_1/comments") || target.includes("/tag1/comments")) {
        throw new Error(`unexpected post comments after ${target}`);
      }
      if (target.includes("/tagc1/comments")) {
        expect(target).toContain("after=tag-reply-2");
        expect(target).toContain("limit=25");
        expect(target).not.toContain("paging.next");
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "tagr-old",
                message: "older tagged nested reply",
                from: { id: "801", name: "Replier" },
                created_time: "2026-08-20T09:00:00+0000",
              },
            ],
          }),
          { status: 200 },
        );
      }
      expect(target).toContain(`${FACEBOOK_GRAPH_ORIGIN}/555/tagged`);
      expect(decodeURIComponent(target)).toContain("comments.limit(25)");
      expect(target).not.toContain("after=");
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "tag1",
              message: "tagged the page",
              from: { id: "900", name: "Lead" },
              created_time: "2026-08-21T12:00:00+0000",
              permalink_url: "https://www.facebook.com/tag1",
              comments: {
                data: [
                  {
                    id: "tagc1",
                    message: "parent on tagged post",
                    from: { id: "800", name: "Commenter" },
                    created_time: "2026-08-21T12:00:00+0000",
                    comments: {
                      data: [
                        {
                          id: "tagr-new",
                          message: "newer tagged nested reply",
                          from: { id: "801", name: "Replier" },
                          created_time: "2026-08-21T12:00:00+0000",
                        },
                      ],
                      paging: { cursors: { after: "tag-reply-2" } },
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
    expect(first.messages.map((item) => item.externalId)).toEqual(["tagc1", "tagr-new", "tag1"]);
    expect(first.cursor).toBe(
      `comments:2026-08-21T12:00:00+0000|creplies:${encodeGraphReplies({ tagc1: "tag-reply-2" })}|mentions:2026-08-21T12:00:00+0000|posts:done|ratings:done|ratingreplies:done|replies:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done`,
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/tagc1/comments"))).toHaveLength(0);

    const second = await new FacebookAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: first.cursor,
    });
    expect(second.messages.map((item) => item.externalId)).toEqual(["tagr-old"]);
    expect(second.cursor).toBe(
      "comments:2026-08-21T12:00:00+0000|creplies:done|mentions:2026-08-21T12:00:00+0000|posts:done|ratings:done|ratingreplies:done|replies:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done",
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/tagc1/comments"))).toHaveLength(1);
  });

  it("skips Instagram tagged-comment replies after paging once creplies:done is stored", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.includes("/ig-1/media") || target.includes("/ig-1/conversations")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (target.includes("/tagc1/replies") || /\/[^/]+\/replies/.test(new URL(target).pathname)) {
        throw new Error(`unexpected comment replies after ${target}`);
      }
      expect(target).toContain(`${INSTAGRAM_GRAPH_ORIGIN}/ig-1/tags`);
      expect(decodeURIComponent(target)).toContain("replies{");
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "igtag1",
              caption: "tagged you",
              username: "lead",
              timestamp: "2026-08-21T09:00:00+0000",
              permalink: "https://www.instagram.com/p/igtag1/",
              comments: {
                data: [
                  {
                    id: "tagc1",
                    text: "parent on tagged media",
                    from: { id: "80", username: "fan" },
                    timestamp: "2026-08-21T10:00:00+0000",
                    replies: {
                      data: [
                        {
                          id: "tagr-new",
                          text: "newer tagged nested reply",
                          from: { id: "81", username: "replier" },
                          timestamp: "2026-08-21T10:00:00+0000",
                        },
                      ],
                      paging: { cursors: { after: "ig-tag-reply-2" } },
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
      cursor:
        "comments:2026-08-21T08:00:00+0000|creplies:done|posts:done|replies:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["tagc1", "tagr-new", "igtag1"]);
    expect(result.cursor).toBe(
      "comments:2026-08-21T10:00:00+0000|creplies:done|mentions:2026-08-21T09:00:00+0000|posts:done|replies:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done",
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/tagc1/replies"))).toHaveLength(0);
  });
});
