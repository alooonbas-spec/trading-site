import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeGraphReplies } from "@/social/meta/graph-paging";
import { FACEBOOK_GRAPH_ORIGIN } from "@/social/facebook/graph";
import { FacebookAdapter } from "@/social/facebook/adapter";
import { InstagramAdapter } from "@/social/instagram/adapter";
import { INSTAGRAM_GRAPH_ORIGIN } from "@/social/instagram/publish";

describe("PHASE 45 Graph conversation message after paging", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("walks the next official Facebook conversation messages after cursor and keeps older DMs", async () => {
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
      if (target.includes("/555/tagged") || target.includes("/555/ratings") || target.includes("/555/videos") || target.includes("/555/photos") || target.includes("/555/live_videos")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (target.includes("/t_900/messages")) {
        expect(target).toContain("after=msg-2");
        expect(target).not.toContain("paging.next");
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "old-m",
                message: "older thread message",
                from: { id: "900", name: "Lead" },
                created_time: "2026-08-20T09:00:00+0000",
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (target.includes("folder=")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      expect(target).toContain(`${FACEBOOK_GRAPH_ORIGIN}/555/conversations`);
      expect(target).not.toContain("after=");
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "t_900",
              messages: {
                data: [
                  {
                    id: "new-m",
                    message: "newer",
                    from: { id: "900", name: "Lead" },
                    created_time: "2026-08-21T12:00:00+0000",
                  },
                ],
                paging: { cursors: { after: "msg-2" } },
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
    expect(first.messages.map((item) => item.externalId)).toEqual(["new-m"]);
    expect(first.cursor).toBe(
      `creplies:done|donethreads:done|livereplies:done|livevideos:done|messages:2026-08-21T12:00:00+0000|otherthreads:done|pendingthreads:done|photoreplies:done|photos:done|posts:done|ratingreplies:done|ratings:done|replies:done|spamthreads:done|tagged:done|taggedreplies:done|threadmsgs:${encodeGraphReplies({ t_900: "msg-2" })}|threads:done|videoreplies:done|videos:done`,
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/t_900/messages"))).toHaveLength(0);

    const second = await new FacebookAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: first.cursor,
    });
    expect(second.messages.map((item) => item.externalId)).toEqual(["old-m"]);
    expect(second.cursor).toBe(
      "creplies:done|donethreads:done|livereplies:done|livevideos:done|messages:2026-08-21T12:00:00+0000|otherthreads:done|pendingthreads:done|photoreplies:done|photos:done|posts:done|ratingreplies:done|ratings:done|replies:done|spamthreads:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done|videoreplies:done|videos:done",
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/t_900/messages"))).toHaveLength(1);
  });

  it("skips Instagram conversation message after paging once threadmsgs:done is stored", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.includes("/ig-1/media")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (target.includes("/ig-1/tags")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (target.includes("/t_700/messages")) {
        throw new Error(`unexpected conversation messages after ${target}`);
      }
      expect(target).toContain(`${INSTAGRAM_GRAPH_ORIGIN}/ig-1/conversations`);
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "t_700",
              messages: {
                data: [
                  {
                    id: "new-m",
                    message: "newer",
                    from: { id: "700", username: "lead" },
                    created_time: "2026-08-21T09:00:00+0000",
                  },
                ],
                paging: { cursors: { after: "ig-msg-2" } },
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
      cursor: "creplies:done|messages:2026-08-21T08:00:00+0000|posts:done|replies:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["new-m"]);
    expect(result.cursor).toBe(
      "creplies:done|messages:2026-08-21T09:00:00+0000|posts:done|replies:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done",
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/t_700/messages"))).toHaveLength(0);
  });
});
