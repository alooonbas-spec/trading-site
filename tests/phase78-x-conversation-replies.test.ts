import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeXPageMap, encodeXPageToken } from "@/social/x/paging";
import { XAdapter } from "@/social/x/adapter";
import { X_RECENT_SEARCH_INBOX_URL, isXReplyToSearch, isXRetweetSearch, xMentionReplyUrl } from "@/social/x/inbox";

function isXUserTweets(target: string): boolean {
  return /\/2\/users\/[^/]+\/tweets(?:\?|$)/.test(target);
}

function conversationQuery(target: string): string | null {
  try {
    return new URL(target).searchParams.get("query");
  } catch {
    return null;
  }
}

describe("PHASE 78 X conversation replies", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("walks the next official user tweets pagination_token and keeps older replies", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.startsWith("https://api.x.com/2/users/me")) {
        return new Response(JSON.stringify({ data: { id: "100", username: "hub" } }), { status: 200 });
      }
      if (target.includes("/mentions") || target.includes("/dm_events") || target.includes("/quote_tweets")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (target.includes("/2/tweets/search/recent")) {
        if (isXRetweetSearch(target) || isXReplyToSearch(target)) {
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }
        expect(target.startsWith(X_RECENT_SEARCH_INBOX_URL)).toBe(true);
        expect(target).not.toContain("paging.next");
        expect(target).toContain("max_results=10");
        if (conversationQuery(target) === "conversation_id:9002 is:reply") {
          expect(target).not.toContain("pagination_token=");
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: "8000",
                  text: "older reply",
                  author_id: "800",
                  created_at: "2026-08-20T09:00:00.000Z",
                },
              ],
              includes: { users: [{ id: "800", username: "replier" }] },
            }),
            { status: 200 },
          );
        }
        expect(conversationQuery(target)).toBe("conversation_id:9001 is:reply");
        expect(target).not.toContain("pagination_token=");
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "8001",
                text: "newer reply",
                author_id: "800",
                created_at: "2026-08-21T12:00:00.000Z",
              },
              {
                id: "8002",
                text: "own reply",
                author_id: "100",
                created_at: "2026-08-21T12:01:00.000Z",
              },
            ],
            includes: { users: [{ id: "800", username: "replier" }] },
          }),
          { status: 200 },
        );
      }
      expect(isXUserTweets(target)).toBe(true);
      expect(target).toContain("exclude=retweets");
      expect(target).not.toContain("paging.next");
      if (target.includes("pagination_token=tweet-2")) {
        return new Response(JSON.stringify({ data: [{ id: "9002" }] }), { status: 200 });
      }
      expect(target).not.toContain("pagination_token=");
      return new Response(
        JSON.stringify({
          data: [{ id: "9001" }],
          meta: { next_token: "tweet-2" },
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
        externalId: "8001",
        externalProfileId: "800",
        username: "@replier",
        body: "newer reply",
        url: "https://x.com/replier/status/8001",
        receivedAt: "2026-08-21T12:00:00.000Z",
        replyKind: "mention",
      },
    ]);
    expect(first.cursor).toBe(
      `dmpages:done|mentionpages:done|quotepages:done|replies:8001|replypages:done|replytopages:done|retweetpages:done|tweetpages:${encodeXPageToken("tweet-2")}`,
    );
    expect(fetchMock.mock.calls.filter(([url]) => isXUserTweets(String(url)))).toHaveLength(1);

    const second = await new XAdapter({ accessToken: "x-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: first.cursor,
    });
    expect(second.messages.map((item) => item.externalId)).toEqual(["8000"]);
    expect(second.cursor).toBe(
      "dmpages:done|mentionpages:done|quotepages:done|replies:8001|replypages:done|replytopages:done|retweetpages:done|tweetpages:done",
    );
    expect(fetchMock.mock.calls.filter(([url]) => isXUserTweets(String(url)))).toHaveLength(3);
  });

  it("walks the next official search recent pagination_token and keeps older replies", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.startsWith("https://api.x.com/2/users/me")) {
        return new Response(JSON.stringify({ data: { id: "100", username: "hub" } }), { status: 200 });
      }
      if (target.includes("/mentions") || target.includes("/dm_events") || target.includes("/quote_tweets")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (isXUserTweets(target)) {
        expect(target).not.toContain("pagination_token=");
        return new Response(JSON.stringify({ data: [{ id: "9001" }] }), { status: 200 });
      }
      expect(target.startsWith(X_RECENT_SEARCH_INBOX_URL)).toBe(true);
      if (isXRetweetSearch(target) || isXReplyToSearch(target)) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      expect(conversationQuery(target)).toBe("conversation_id:9001 is:reply");
      expect(target).not.toContain("paging.next");
      if (target.includes("pagination_token=reply-2")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "8000",
                text: "older reply",
                author_id: "800",
                created_at: "2026-08-20T09:00:00.000Z",
              },
            ],
            includes: { users: [{ id: "800", username: "replier" }] },
          }),
          { status: 200 },
        );
      }
      expect(target).not.toContain("pagination_token=");
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "8001",
              text: "newer reply",
              author_id: "800",
              created_at: "2026-08-21T12:00:00.000Z",
            },
          ],
          includes: { users: [{ id: "800", username: "replier" }] },
          meta: { next_token: "reply-2" },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await new XAdapter({ accessToken: "x-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
    });
    expect(first.messages.map((item) => item.externalId)).toEqual(["8001"]);
    expect(first.cursor).toBe(
      `dmpages:done|mentionpages:done|quotepages:done|replies:8001|replypages:${encodeXPageMap({ "9001": "reply-2" })}|replytopages:done|retweetpages:done|tweetpages:done`,
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("pagination_token=reply-2"))).toHaveLength(0);

    const second = await new XAdapter({ accessToken: "x-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: first.cursor,
    });
    expect(second.messages.map((item) => item.externalId)).toEqual(["8000"]);
    expect(second.cursor).toBe(
      "dmpages:done|mentionpages:done|quotepages:done|replies:8001|replypages:done|replytopages:done|retweetpages:done|tweetpages:done",
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("pagination_token=reply-2"))).toHaveLength(1);
  });

  it("skips reply after paging once tweetpages:done and replypages:done are stored", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.startsWith("https://api.x.com/2/users/me")) {
        return new Response(JSON.stringify({ data: { id: "100", username: "hub" } }), { status: 200 });
      }
      if (target.includes("/mentions") || target.includes("/dm_events") || target.includes("/quote_tweets")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (target.includes("pagination_token=")) {
        throw new Error(`unexpected pagination_token ${target}`);
      }
      if (target.includes("/2/tweets/search/recent")) {
        if (isXRetweetSearch(target) || isXReplyToSearch(target)) {
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }
        expect(conversationQuery(target)).toBe("conversation_id:9001 is:reply");
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "8001",
                text: "newer reply",
                author_id: "800",
                created_at: "2026-08-21T10:00:00.000Z",
              },
            ],
            includes: { users: [{ id: "800", username: "replier" }] },
            meta: { next_token: "reply-2" },
          }),
          { status: 200 },
        );
      }
      expect(isXUserTweets(target)).toBe(true);
      return new Response(
        JSON.stringify({
          data: [{ id: "9001" }],
          meta: { next_token: "tweet-2" },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new XAdapter({ accessToken: "x-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: "replies:7990|replypages:done|tweetpages:done",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["8001"]);
    expect(result.cursor).toBe(
      "dmpages:done|mentionpages:done|quotepages:done|replies:8001|replypages:done|replytopages:done|retweetpages:done|tweetpages:done",
    );
    expect(fetchMock.mock.calls.filter(([url]) => isXUserTweets(String(url)))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("pagination_token="))).toHaveLength(0);
  });

  it("drops duplicate reply ids already collected as mentions", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.startsWith("https://api.x.com/2/users/me")) {
        return new Response(JSON.stringify({ data: { id: "100", username: "hub" } }), { status: 200 });
      }
      if (target.includes("/dm_events") || target.includes("/quote_tweets")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (target.includes("/mentions")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "8001",
                text: "@hub newer reply",
                author_id: "800",
                created_at: "2026-08-21T12:00:00.000Z",
              },
            ],
            includes: { users: [{ id: "800", username: "replier" }] },
            meta: { newest_id: "8001" },
          }),
          { status: 200 },
        );
      }
      if (target.includes("/2/tweets/search/recent")) {
        if (isXRetweetSearch(target) || isXReplyToSearch(target)) {
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "8001",
                text: "@hub newer reply",
                author_id: "800",
                created_at: "2026-08-21T12:00:00.000Z",
              },
            ],
            includes: { users: [{ id: "800", username: "replier" }] },
          }),
          { status: 200 },
        );
      }
      expect(isXUserTweets(target)).toBe(true);
      return new Response(JSON.stringify({ data: [{ id: "9001" }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new XAdapter({ accessToken: "x-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
    });
    expect(result.messages.filter((item) => item.externalId === "8001")).toHaveLength(1);
  });

  it("replies to X conversation replies through the existing mention tweet endpoint", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(xMentionReplyUrl());
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        text: "Thanks",
        reply: { in_reply_to_tweet_id: "8001" },
      });
      return new Response(JSON.stringify({ data: { id: "reply-99" } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const sent = await new XAdapter({ accessToken: "x-token" }).replyToInbox({
      workspaceId: "w",
      socialAccountId: "a",
      kind: "mention",
      body: "Thanks",
      externalEventId: "8001",
      target: { externalProfileId: "800", username: "@replier" },
    });
    expect(sent.externalMessageId).toBe("reply-99");
  });
});
