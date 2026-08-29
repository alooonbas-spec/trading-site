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

describe("PHASE 83 X to:user recent search", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("walks the next official to:user pagination_token and keeps older replies to the user", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.startsWith("https://api.x.com/2/users/me")) {
        return new Response(JSON.stringify({ data: { id: "100", username: "hub" } }), { status: 200 });
      }
      if (
        target.includes("/mentions") ||
        target.includes("/dm_events") ||
        target.includes("/quote_tweets") ||
        isXUserTweets(target) ||
        isXRetweetSearch(target)
      ) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      expect(isXReplyToSearch(target)).toBe(true);
      expect(target.startsWith(X_RECENT_SEARCH_INBOX_URL)).toBe(true);
      expect(searchQuery(target)).toBe("to:100");
      expect(target).toContain("max_results=10");
      expect(target).not.toContain("paging.next");
      if (target.includes("pagination_token=to-2")) {
        expect(target).not.toContain("since_id=");
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "5000",
                text: "older reply to hub",
                author_id: "800",
                created_at: "2026-08-20T09:00:00.000Z",
              },
            ],
            includes: { users: [{ id: "800", username: "replier" }] },
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
              id: "5001",
              text: "newer reply to hub",
              author_id: "800",
              created_at: "2026-08-21T12:00:00.000Z",
            },
            {
              id: "5002",
              text: "own reply to hub",
              author_id: "100",
              created_at: "2026-08-21T12:01:00.000Z",
            },
          ],
          includes: { users: [{ id: "800", username: "replier" }] },
          meta: { next_token: "to-2" },
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
        externalId: "5001",
        externalProfileId: "800",
        username: "@replier",
        body: "newer reply to hub",
        url: "https://x.com/replier/status/5001",
        receivedAt: "2026-08-21T12:00:00.000Z",
        replyKind: "mention",
      },
    ]);
    expect(first.cursor).toBe(
      `dmpages:done|mentionpages:done|quotepages:done|replypages:done|replyto:5001|replytopages:${encodeXPageToken("to-2")}|retweetpages:done|tweetpages:done`,
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("pagination_token=to-2"))).toHaveLength(0);

    const second = await new XAdapter({ accessToken: "x-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: first.cursor,
    });
    expect(second.messages.map((item) => item.externalId)).toEqual(["5000"]);
    expect(second.cursor).toBe(
      "dmpages:done|mentionpages:done|quotepages:done|replypages:done|replyto:5001|replytopages:done|retweetpages:done|tweetpages:done",
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("pagination_token=to-2"))).toHaveLength(1);
  });

  it("skips to:user pagination_token once replytopages:done is stored", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.startsWith("https://api.x.com/2/users/me")) {
        return new Response(JSON.stringify({ data: { id: "100", username: "hub" } }), { status: 200 });
      }
      if (
        target.includes("/mentions") ||
        target.includes("/dm_events") ||
        target.includes("/quote_tweets") ||
        isXUserTweets(target) ||
        isXRetweetSearch(target)
      ) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      expect(isXReplyToSearch(target)).toBe(true);
      if (target.includes("pagination_token=")) {
        throw new Error(`unexpected to:user pagination_token ${target}`);
      }
      expect(target).toContain("since_id=4990");
      expect(searchQuery(target)).toBe("to:100");
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "5001",
              text: "newer reply to hub",
              author_id: "800",
              created_at: "2026-08-21T10:00:00.000Z",
            },
          ],
          includes: { users: [{ id: "800", username: "replier" }] },
          meta: { next_token: "to-2" },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new XAdapter({ accessToken: "x-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: "replyto:4990|replytopages:done",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["5001"]);
    expect(result.cursor).toBe(
      "dmpages:done|mentionpages:done|quotepages:done|replypages:done|replyto:5001|replytopages:done|retweetpages:done|tweetpages:done",
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("pagination_token="))).toHaveLength(0);
  });

  it("drops duplicate to:user ids already collected as mentions", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.startsWith("https://api.x.com/2/users/me")) {
        return new Response(JSON.stringify({ data: { id: "100", username: "hub" } }), { status: 200 });
      }
      if (
        target.includes("/dm_events") ||
        target.includes("/quote_tweets") ||
        isXUserTweets(target) ||
        isXRetweetSearch(target)
      ) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (target.includes("/mentions")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "5001",
                text: "newer reply to hub",
                author_id: "800",
                created_at: "2026-08-21T12:00:00.000Z",
              },
            ],
            includes: { users: [{ id: "800", username: "replier" }] },
            meta: { newest_id: "5001" },
          }),
          { status: 200 },
        );
      }
      expect(isXReplyToSearch(target)).toBe(true);
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "5001",
              text: "newer reply to hub",
              author_id: "800",
              created_at: "2026-08-21T12:00:00.000Z",
            },
          ],
          includes: { users: [{ id: "800", username: "replier" }] },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new XAdapter({ accessToken: "x-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
    });
    expect(result.messages.filter((item) => item.externalId === "5001")).toHaveLength(1);
  });

  it("replies to X to:user posts through the existing mention tweet endpoint", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(xMentionReplyUrl());
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        text: "Thanks",
        reply: { in_reply_to_tweet_id: "5001" },
      });
      return new Response(JSON.stringify({ data: { id: "reply-99" } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const sent = await new XAdapter({ accessToken: "x-token" }).replyToInbox({
      workspaceId: "w",
      socialAccountId: "a",
      kind: "mention",
      body: "Thanks",
      externalEventId: "5001",
      target: { externalProfileId: "800", username: "@replier" },
    });
    expect(sent.externalMessageId).toBe("reply-99");
  });
});
