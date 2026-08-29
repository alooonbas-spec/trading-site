import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeXPageMap, encodeXPageToken, nextXPageMapCursor } from "@/social/x/paging";
import { XAdapter } from "@/social/x/adapter";
import { xMentionReplyUrl } from "@/social/x/inbox";

function isXUserTweets(target: string): boolean {
  return /\/2\/users\/[^/]+\/tweets(?:\?|$)/.test(target);
}

describe("PHASE 76 X quote tweets", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("encodes quote page maps and stays done once stored", () => {
    expect(encodeXPageMap({})).toBe("done");
    expect(encodeXPageMap({ "9001": "quote-2" })).toBe(
      encodeXPageToken(JSON.stringify({ "9001": "quote-2" })),
    );
    expect(
      nextXPageMapCursor({
        stored: "done",
        nestedTokens: { "9001": "quote-2" },
        fetchedNextTokens: { "9001": "quote-3" },
        fetchedIds: ["9001"],
      }),
    ).toBe("done");
  });

  it("walks the next official user tweets pagination_token and keeps older quotes", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.startsWith("https://api.x.com/2/users/me")) {
        return new Response(JSON.stringify({ data: { id: "100", username: "hub" } }), { status: 200 });
      }
      if (target.includes("/mentions") || target.includes("/dm_events")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (target.includes("/quote_tweets")) {
        expect(target).not.toContain("paging.next");
        if (target.includes("/tweets/9002/quote_tweets")) {
          expect(target).not.toContain("pagination_token=");
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: "7000",
                  text: "older quote",
                  author_id: "800",
                  created_at: "2026-08-20T09:00:00.000Z",
                },
              ],
              includes: { users: [{ id: "800", username: "quoter" }] },
            }),
            { status: 200 },
          );
        }
        expect(target).toContain("/tweets/9001/quote_tweets");
        expect(target).not.toContain("pagination_token=");
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "7001",
                text: "newer quote",
                author_id: "800",
                created_at: "2026-08-21T12:00:00.000Z",
              },
              {
                id: "7002",
                text: "own quote",
                author_id: "100",
                created_at: "2026-08-21T12:01:00.000Z",
              },
            ],
            includes: { users: [{ id: "800", username: "quoter" }] },
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
        externalId: "7001",
        externalProfileId: "800",
        username: "@quoter",
        body: "newer quote",
        url: "https://x.com/quoter/status/7001",
        receivedAt: "2026-08-21T12:00:00.000Z",
        replyKind: "mention",
      },
    ]);
    expect(first.cursor).toBe(
      `dmpages:done|mentionpages:done|quotepages:done|quotes:7001|tweetpages:${encodeXPageToken("tweet-2")}`,
    );
    expect(fetchMock.mock.calls.filter(([url]) => isXUserTweets(String(url)))).toHaveLength(1);

    const second = await new XAdapter({ accessToken: "x-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: first.cursor,
    });
    expect(second.messages.map((item) => item.externalId)).toEqual(["7000"]);
    expect(second.cursor).toBe("dmpages:done|mentionpages:done|quotepages:done|quotes:7001|tweetpages:done");
    expect(fetchMock.mock.calls.filter(([url]) => isXUserTweets(String(url)))).toHaveLength(3);
  });

  it("walks the next official quote_tweets pagination_token and keeps older quotes", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.startsWith("https://api.x.com/2/users/me")) {
        return new Response(JSON.stringify({ data: { id: "100", username: "hub" } }), { status: 200 });
      }
      if (target.includes("/mentions") || target.includes("/dm_events")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (isXUserTweets(target)) {
        expect(target).not.toContain("pagination_token=");
        return new Response(JSON.stringify({ data: [{ id: "9001" }] }), { status: 200 });
      }
      expect(target).toContain("https://api.x.com/2/tweets/9001/quote_tweets");
      expect(target).not.toContain("paging.next");
      if (target.includes("pagination_token=quote-2")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "7000",
                text: "older quote",
                author_id: "800",
                created_at: "2026-08-20T09:00:00.000Z",
              },
            ],
            includes: { users: [{ id: "800", username: "quoter" }] },
          }),
          { status: 200 },
        );
      }
      expect(target).not.toContain("pagination_token=");
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "7001",
              text: "newer quote",
              author_id: "800",
              created_at: "2026-08-21T12:00:00.000Z",
            },
          ],
          includes: { users: [{ id: "800", username: "quoter" }] },
          meta: { next_token: "quote-2" },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await new XAdapter({ accessToken: "x-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
    });
    expect(first.messages.map((item) => item.externalId)).toEqual(["7001"]);
    expect(first.cursor).toBe(
      `dmpages:done|mentionpages:done|quotepages:${encodeXPageMap({ "9001": "quote-2" })}|quotes:7001|tweetpages:done`,
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("pagination_token=quote-2"))).toHaveLength(0);

    const second = await new XAdapter({ accessToken: "x-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: first.cursor,
    });
    expect(second.messages.map((item) => item.externalId)).toEqual(["7000"]);
    expect(second.cursor).toBe("dmpages:done|mentionpages:done|quotepages:done|quotes:7001|tweetpages:done");
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("pagination_token=quote-2"))).toHaveLength(1);
  });

  it("skips quote after paging once tweetpages:done and quotepages:done are stored", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.startsWith("https://api.x.com/2/users/me")) {
        return new Response(JSON.stringify({ data: { id: "100", username: "hub" } }), { status: 200 });
      }
      if (target.includes("/mentions") || target.includes("/dm_events")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (target.includes("pagination_token=")) {
        throw new Error(`unexpected pagination_token ${target}`);
      }
      if (target.includes("/quote_tweets")) {
        expect(target).toContain("/tweets/9001/quote_tweets");
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "7001",
                text: "newer quote",
                author_id: "800",
                created_at: "2026-08-21T10:00:00.000Z",
              },
            ],
            includes: { users: [{ id: "800", username: "quoter" }] },
            meta: { next_token: "quote-2" },
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
      cursor: "quotes:6990|quotepages:done|tweetpages:done",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["7001"]);
    expect(result.cursor).toBe("dmpages:done|mentionpages:done|quotepages:done|quotes:7001|tweetpages:done");
    expect(fetchMock.mock.calls.filter(([url]) => isXUserTweets(String(url)))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("pagination_token="))).toHaveLength(0);
  });

  it("replies to X quote tweets through the existing mention tweet endpoint", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(xMentionReplyUrl());
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        text: "Thanks",
        reply: { in_reply_to_tweet_id: "7001" },
      });
      return new Response(JSON.stringify({ data: { id: "reply-99" } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const sent = await new XAdapter({ accessToken: "x-token" }).replyToInbox({
      workspaceId: "w",
      socialAccountId: "a",
      kind: "mention",
      body: "Thanks",
      externalEventId: "7001",
      target: { externalProfileId: "800", username: "@quoter" },
    });
    expect(sent.externalMessageId).toBe("reply-99");
  });
});
