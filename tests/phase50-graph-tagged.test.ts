import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeGraphAfter } from "@/social/meta/graph-paging";
import { FACEBOOK_GRAPH_ORIGIN, FACEBOOK_SCOPES } from "@/social/facebook/graph";
import { FacebookAdapter } from "@/social/facebook/adapter";
import { facebookCommentReplyUrl } from "@/social/facebook/inbox";
import { InstagramAdapter } from "@/social/instagram/adapter";
import { INSTAGRAM_GRAPH_ORIGIN } from "@/social/instagram/publish";
import { instagramMediaCommentUrl } from "@/social/instagram/inbox";

describe("PHASE 50 Graph tagged mention after paging", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests pages_read_user_content for Page tagged posts", () => {
    expect(FACEBOOK_SCOPES).toContain("pages_read_user_content");
  });

  it("walks the next official Facebook tagged after cursor and keeps older mentions", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.startsWith(`${FACEBOOK_GRAPH_ORIGIN}/me/accounts`)) {
        return new Response(
          JSON.stringify({ data: [{ id: "555", name: "Hub Page", access_token: "page-token" }] }),
          { status: 200 },
        );
      }
      if (target.includes("/555/feed") || target.includes("/555/conversations") || target.includes("/555/videos") || target.includes("/555/photos") || target.includes("/555/live_videos")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (target.includes("/555/ratings") || target.includes("/555/videos") || target.includes("/555/photos") || target.includes("/555/live_videos")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      expect(target).toContain(`${FACEBOOK_GRAPH_ORIGIN}/555/tagged`);
      expect(target).not.toContain("paging.next");
      if (target.includes("after=tag-2")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "old-tag",
                message: "older tagged post",
                from: { id: "900", name: "Lead" },
                created_time: "2026-08-20T09:00:00+0000",
                permalink_url: "https://www.facebook.com/old-tag",
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
              id: "new-tag",
              message: "newer tagged post",
              from: { id: "900", name: "Lead" },
              created_time: "2026-08-21T12:00:00+0000",
              permalink_url: "https://www.facebook.com/new-tag",
            },
          ],
          paging: { cursors: { after: "tag-2" } },
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
        externalId: "new-tag",
        externalProfileId: "900",
        username: "Lead",
        body: "newer tagged post",
        url: "https://www.facebook.com/new-tag",
        receivedAt: "2026-08-21T12:00:00+0000",
        replyKind: "mention",
      },
    ]);
    expect(first.cursor).toBe(
      `creplies:done|donethreads:done|livereplies:done|livevideos:done|mentions:2026-08-21T12:00:00+0000|otherthreads:done|pendingthreads:done|photoreplies:done|photos:done|posts:done|ratingreplies:done|ratings:done|replies:done|spamthreads:done|tagged:${encodeGraphAfter("tag-2")}|taggedreplies:done|threadmsgs:done|threads:done|videoreplies:done|videos:done`,
    );

    const second = await new FacebookAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: first.cursor,
    });
    expect(second.messages.map((item) => item.externalId)).toEqual(["old-tag"]);
    expect(second.cursor).toBe(
      "creplies:done|donethreads:done|livereplies:done|livevideos:done|mentions:2026-08-21T12:00:00+0000|otherthreads:done|pendingthreads:done|photoreplies:done|photos:done|posts:done|ratingreplies:done|ratings:done|replies:done|spamthreads:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done|videoreplies:done|videos:done",
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/555/tagged"))).toHaveLength(3);
  });

  it("skips Instagram tags after paging once tagged:done is stored", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.includes("/ig-1/media") || target.includes("/ig-1/conversations")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      expect(target).toContain(`${INSTAGRAM_GRAPH_ORIGIN}/ig-1/tags`);
      if (target.includes("after=")) {
        throw new Error(`unexpected tags after ${target}`);
      }
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "new-tag",
              caption: "tagged you",
              username: "lead",
              timestamp: "2026-08-21T09:00:00+0000",
              permalink: "https://www.instagram.com/p/new-tag/",
            },
          ],
          paging: { cursors: { after: "ig-tag-2" } },
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
      cursor: "mentions:2026-08-21T08:00:00+0000|tagged:done",
    });
    expect(result.messages).toEqual([
      {
        externalId: "new-tag",
        externalProfileId: "lead",
        username: "@lead",
        body: "tagged you",
        url: "https://www.instagram.com/p/new-tag/",
        receivedAt: "2026-08-21T09:00:00+0000",
        replyKind: "mention",
      },
    ]);
    expect(result.cursor).toBe(
      "creplies:done|mentions:2026-08-21T09:00:00+0000|posts:done|replies:done|tagged:done|taggedreplies:done|threadmsgs:done|threads:done",
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/ig-1/tags"))).toHaveLength(1);
  });

  it("replies to Facebook tagged posts through official post comments", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      if (target.startsWith(`${FACEBOOK_GRAPH_ORIGIN}/me/accounts`)) {
        return new Response(
          JSON.stringify({ data: [{ id: "555", name: "Hub Page", access_token: "page-token" }] }),
          { status: 200 },
        );
      }
      expect(target.startsWith(facebookCommentReplyUrl("new-tag"))).toBe(true);
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ message: "Thanks for the tag" });
      return new Response(JSON.stringify({ id: "tag_reply" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const sent = await new FacebookAdapter({ accessToken: "user-token" }).replyToInbox({
      workspaceId: "w",
      socialAccountId: "a",
      kind: "mention",
      body: "Thanks for the tag",
      externalEventId: "new-tag",
      target: { externalProfileId: "900", username: "Lead" },
    });
    expect(sent.externalMessageId).toBe("tag_reply");
  });

  it("replies to Instagram tagged media through official media comments", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url).startsWith(instagramMediaCommentUrl("new-tag"))).toBe(true);
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ message: "Thanks" });
      return new Response(JSON.stringify({ id: "media_reply" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const sent = await new InstagramAdapter({
      accessToken: "ig-token",
      metadata: { instagramUserId: "ig-1" },
    }).replyToInbox({
      workspaceId: "w",
      socialAccountId: "a",
      kind: "mention",
      body: "Thanks",
      externalEventId: "new-tag",
      target: { externalProfileId: "lead", username: "@lead" },
    });
    expect(sent.externalMessageId).toBe("media_reply");
  });
});
