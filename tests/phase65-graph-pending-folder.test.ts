import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeGraphAfter } from "@/social/meta/graph-paging";
import { FACEBOOK_GRAPH_ORIGIN } from "@/social/facebook/graph";
import { FacebookAdapter } from "@/social/facebook/adapter";
import { InstagramAdapter } from "@/social/instagram/adapter";
import { INSTAGRAM_GRAPH_ORIGIN } from "@/social/instagram/publish";

describe("PHASE 65 Graph Facebook conversations folder=pending", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("walks the next official Pending-folder after cursor and keeps older DMs", async () => {
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
        target.includes("/555/videos")
      ) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      expect(target).toContain(`${FACEBOOK_GRAPH_ORIGIN}/555/conversations`);
      expect(target).toContain("platform=MESSENGER");
      if (target.includes("folder=") && !target.includes("folder=pending")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (!target.includes("folder=pending")) {
        expect(target).not.toContain("folder=");
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (target.includes("after=pending-2")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                messages: {
                  data: [
                    {
                      id: "old-pending-m",
                      message: "older pending folder",
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
                    id: "new-pending-m",
                    message: "newer pending folder",
                    from: { id: "900", name: "Lead" },
                    created_time: "2026-08-21T12:00:00+0000",
                  },
                ],
              },
            },
          ],
          paging: { cursors: { after: "pending-2" } },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await new FacebookAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
    });
    expect(first.messages.map((item) => item.externalId)).toEqual(["new-pending-m"]);
    expect(first.cursor).toBe(
      `creplies:done|donethreads:done|messages:2026-08-21T12:00:00+0000|otherthreads:done|pendingthreads:${encodeGraphAfter("pending-2")}|posts:done|ratingreplies:done|ratings:done|replies:done|spamthreads:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done|videoreplies:done|videos:done`,
    );

    const second = await new FacebookAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: first.cursor,
    });
    expect(second.messages.map((item) => item.externalId)).toEqual(["old-pending-m"]);
    expect(second.cursor).toBe(
      "creplies:done|donethreads:done|messages:2026-08-21T12:00:00+0000|otherthreads:done|pendingthreads:done|posts:done|ratingreplies:done|ratings:done|replies:done|spamthreads:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done|videoreplies:done|videos:done",
    );
    expect(
      fetchMock.mock.calls.filter(
        ([url]) => String(url).includes("/555/conversations") && String(url).includes("folder=pending"),
      ),
    ).toHaveLength(3);
  });

  it("skips Pending-folder after paging once pendingthreads:done is stored", async () => {
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
        target.includes("/555/videos")
      ) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      expect(target).toContain(`${FACEBOOK_GRAPH_ORIGIN}/555/conversations`);
      if (target.includes("folder=") && !target.includes("folder=pending")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (!target.includes("folder=pending")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (target.includes("after=")) {
        throw new Error(`unexpected Pending-folder after ${target}`);
      }
      return new Response(
        JSON.stringify({
          data: [
            {
              messages: {
                data: [
                  {
                    id: "new-pending-m",
                    message: "newer pending folder",
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
      cursor: "messages:2026-08-21T08:00:00+0000|pendingthreads:done|threads:done",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["new-pending-m"]);
    expect(result.cursor).toBe(
      "creplies:done|donethreads:done|messages:2026-08-21T09:00:00+0000|otherthreads:done|pendingthreads:done|posts:done|ratingreplies:done|ratings:done|replies:done|spamthreads:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done|videoreplies:done|videos:done",
    );
    expect(
      fetchMock.mock.calls.filter(
        ([url]) => String(url).includes("/555/conversations") && String(url).includes("folder=pending"),
      ),
    ).toHaveLength(1);
  });

  it("does not request folder=pending for Instagram inbox", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.includes("folder=")) {
        throw new Error("Instagram inbox must not request conversation folders");
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
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("folder="))).toBe(false);
  });
});
