import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeXPageToken } from "@/social/x/paging";
import { XAdapter } from "@/social/x/adapter";
import { X_RECENT_SEARCH_INBOX_URL, isXReplyToSearch, isXRetweetSearch, xMentionReplyUrl } from "@/social/x/inbox";

function isXUserTweets(target: string): boolean {
  return /\/2\/users\/[^/]+\/tweets(?:\?|$)/.test(target);
}

function searchQuery(target: string): string | null {
  try {
    return new URL(target).searchParams.get("query");
  } catch {
    return null;
  }
}

describe("PHASE 82 X retweets_of recent search", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("walks the next official retweets_of pagination_token and keeps older retweets", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.startsWith("https://api.x.com/2/users/me")) {
        return new Response(JSON.stringify({ data: { id: "100", username: "hub" } }), { status: 200 });
      }
      if (
        target.includes("/mentions") ||
        target.includes("/dm_events") ||
        target.includes("/quote_tweets") ||
        isXUserTweets(target)
      ) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (isXReplyToSearch(target)) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      expect(isXRetweetSearch(target)).toBe(true);
      expect(target.startsWith(X_RECENT_SEARCH_INBOX_URL)).toBe(true);
      expect(searchQuery(target)).toBe("retweets_of:100");
      expect(target).toContain("max_results=10");
      expect(target).not.toContain("paging.next");
      if (target.includes("pagination_token=rt-2")) {
        expect(target).not.toContain("since_id=");
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "6000",
                text: "RT @hub: older",
                author_id: "800",
                created_at: "2026-08-20T09:00:00.000Z",
              },
            ],
            includes: { users: [{ id: "800", username: "amplifier" }] },
          }),
          { status: 200 },
        );
      }
      if (target.includes("since_id=")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      expect(target).not.toContain("pagination_token=");
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "6001",
              text: "RT @hub: newer",
              author_id: "800",
              created_at: "2026-08-21T12:00:00.000Z",
            },
            {
              id: "6002",
              text: "RT @hub: own",
              author_id: "100",
              created_at: "2026-08-21T12:01:00.000Z",
            },
          ],
          includes: { users: [{ id: "800", username: "amplifier" }] },
          meta: { next_token: "rt-2" },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await new XAdapter({ accessToken: "x-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
    });
    expect(first.messages).toEqual([
      {
        externalId: "6001",
        externalProfileId: "800",
        username: "@amplifier",
        body: "RT @hub: newer",
        url: "https://x.com/amplifier/status/6001",
        receivedAt: "2026-08-21T12:00:00.000Z",
        replyKind: "mention",
      },
    ]);
    expect(first.cursor).toBe(
      `dmpages:done|mentionpages:done|quotepages:done|replypages:done|replytopages:done|retweetpages:${encodeXPageToken("rt-2")}|retweets:6001|tweetpages:done`,
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("pagination_token=rt-2"))).toHaveLength(0);

    const second = await new XAdapter({ accessToken: "x-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: first.cursor,
    });
    expect(second.messages.map((item) => item.externalId)).toEqual(["6000"]);
    expect(second.cursor).toBe(
      "dmpages:done|mentionpages:done|quotepages:done|replypages:done|replytopages:done|retweetpages:done|retweets:6001|tweetpages:done",
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("pagination_token=rt-2"))).toHaveLength(1);
  });

  it("skips retweet pagination_token once retweetpages:done is stored", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.startsWith("https://api.x.com/2/users/me")) {
        return new Response(JSON.stringify({ data: { id: "100", username: "hub" } }), { status: 200 });
      }
      if (
        target.includes("/mentions") ||
        target.includes("/dm_events") ||
        target.includes("/quote_tweets") ||
        isXUserTweets(target)
      ) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (isXReplyToSearch(target)) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      expect(isXRetweetSearch(target)).toBe(true);
      if (target.includes("pagination_token=")) {
        throw new Error(`unexpected retweet pagination_token ${target}`);
      }
      expect(target).toContain("since_id=5990");
      expect(searchQuery(target)).toBe("retweets_of:100");
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "6001",
              text: "RT @hub: newer",
              author_id: "800",
              created_at: "2026-08-21T10:00:00.000Z",
            },
          ],
          includes: { users: [{ id: "800", username: "amplifier" }] },
          meta: { next_token: "rt-2" },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new XAdapter({ accessToken: "x-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: "retweetpages:done|retweets:5990",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["6001"]);
    expect(result.cursor).toBe(
      "dmpages:done|mentionpages:done|quotepages:done|replypages:done|replytopages:done|retweetpages:done|retweets:6001|tweetpages:done",
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("pagination_token="))).toHaveLength(0);
  });

  it("drops duplicate retweet ids already collected as mentions", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.startsWith("https://api.x.com/2/users/me")) {
        return new Response(JSON.stringify({ data: { id: "100", username: "hub" } }), { status: 200 });
      }
      if (target.includes("/dm_events") || target.includes("/quote_tweets") || isXUserTweets(target)) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (isXReplyToSearch(target)) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (target.includes("/mentions")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "6001",
                text: "RT @hub: newer",
                author_id: "800",
                created_at: "2026-08-21T12:00:00.000Z",
              },
            ],
            includes: { users: [{ id: "800", username: "amplifier" }] },
            meta: { newest_id: "6001" },
          }),
          { status: 200 },
        );
      }
      expect(isXRetweetSearch(target)).toBe(true);
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "6001",
              text: "RT @hub: newer",
              author_id: "800",
              created_at: "2026-08-21T12:00:00.000Z",
            },
          ],
          includes: { users: [{ id: "800", username: "amplifier" }] },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new XAdapter({ accessToken: "x-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
    });
    expect(result.messages.filter((item) => item.externalId === "6001")).toHaveLength(1);
  });

  it("replies to X retweets through the existing mention tweet endpoint", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(xMentionReplyUrl());
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        text: "Thanks",
        reply: { in_reply_to_tweet_id: "6001" },
      });
      return new Response(JSON.stringify({ data: { id: "reply-99" } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const sent = await new XAdapter({ accessToken: "x-token" }).replyToInbox({
      workspaceId: "w",
      socialAccountId: "a",
      kind: "mention",
      body: "Thanks",
      externalEventId: "6001",
      target: { externalProfileId: "800", username: "@amplifier" },
    });
    expect(sent.externalMessageId).toBe("reply-99");
  });
});
