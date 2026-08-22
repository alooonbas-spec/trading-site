import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeGraphAfter, graphPagingAfter, nextGraphAfterCursor } from "@/social/meta/graph-paging";
import { FACEBOOK_GRAPH_ORIGIN } from "@/social/facebook/graph";
import { FacebookAdapter } from "@/social/facebook/adapter";
import { InstagramAdapter } from "@/social/instagram/adapter";
import { INSTAGRAM_GRAPH_ORIGIN } from "@/social/instagram/publish";

describe("Graph conversation paging helpers", () => {
  it("reads paging.cursors.after and paging.next after=, then encodes the threads cursor", () => {
    expect(graphPagingAfter({ paging: { cursors: { after: "page-2" } } })).toBe("page-2");
    expect(
      graphPagingAfter({
        paging: { next: "https://graph.facebook.com/v21.0/555/conversations?after=from-next" },
      }),
    ).toBe("from-next");
    expect(graphPagingAfter({ data: [] })).toBeNull();
    expect(
      nextGraphAfterCursor({
        firstPageAfter: "page-2",
        olderPageAfter: null,
        fetchedOlder: false,
      }),
    ).toBe(encodeGraphAfter("page-2"));
    expect(
      nextGraphAfterCursor({
        stored: encodeGraphAfter("page-2"),
        firstPageAfter: "page-2",
        olderPageAfter: null,
        fetchedOlder: true,
      }),
    ).toBe("done");
  });
});

describe("PHASE 42 Graph conversation after paging", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("walks the next official Facebook conversations after cursor and keeps older DMs", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.startsWith(`${FACEBOOK_GRAPH_ORIGIN}/me/accounts`)) {
        return new Response(
          JSON.stringify({ data: [{ id: "555", name: "Hub Page", access_token: "page-token" }] }),
          { status: 200 },
        );
      }
      if (target.includes("/555/feed")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (target.includes("/555/tagged") || target.includes("/555/ratings")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      expect(target).toContain(`${FACEBOOK_GRAPH_ORIGIN}/555/conversations`);
      expect(target).toContain("platform=MESSENGER");
      if (target.includes("after=page-2")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                messages: {
                  data: [
                    {
                      id: "old-thread-m",
                      message: "older thread",
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
                    id: "new-m",
                    message: "newer",
                    from: { id: "900", name: "Lead" },
                    created_time: "2026-08-21T12:00:00+0000",
                  },
                ],
              },
            },
          ],
          paging: { cursors: { after: "page-2" } },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await new FacebookAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
    });
    expect(first.messages.map((item) => item.externalId)).toEqual(["new-m"]);
    expect(first.cursor).toBe(
      `creplies:done|messages:2026-08-21T12:00:00+0000|posts:done|ratings:done|replies:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:${encodeGraphAfter("page-2")}`,
    );

    const second = await new FacebookAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: first.cursor,
    });
    expect(second.messages.map((item) => item.externalId)).toEqual(["old-thread-m"]);
    expect(second.cursor).toBe("creplies:done|messages:2026-08-21T12:00:00+0000|posts:done|ratings:done|replies:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done");
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes("/555/conversations")),
    ).toHaveLength(3);
  });

  it("walks the next official Instagram conversations after cursor and skips after done", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.includes("/ig-1/media")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (target.includes("/ig-1/tags")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      expect(target).toContain(`${INSTAGRAM_GRAPH_ORIGIN}/ig-1/conversations`);
      expect(target).toContain("platform=instagram");
      if (target.includes("after=")) {
        throw new Error(`unexpected conversations after ${target}`);
      }
      return new Response(
        JSON.stringify({
          data: [
            {
              messages: {
                data: [
                  {
                    id: "new-m",
                    message: "newer",
                    from: { id: "700", username: "lead" },
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

    const result = await new InstagramAdapter({
      accessToken: "ig-token",
      metadata: { instagramUserId: "ig-1" },
    }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: "creplies:done|messages:2026-08-21T08:00:00+0000|threads:done",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["new-m"]);
    expect(result.cursor).toBe("creplies:done|messages:2026-08-21T09:00:00+0000|posts:done|replies:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done");
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes("/ig-1/conversations")),
    ).toHaveLength(1);
  });
});
