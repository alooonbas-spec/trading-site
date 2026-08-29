import { z } from "zod";
import { AuthenticationError, SocialError, ValidationError } from "@/lib/errors";
import {
  isDigitIdAfter,
  laterDigitId,
  parseNamedInboxCursor,
  serializeNamedInboxCursor,
  uniqueInboxMessages,
} from "@/lib/inbox/cursor";
import { readJson, socialFetch } from "@/social/core/http";
import type { InboxInput, InboxMessage, InboxResult } from "@/social/core/adapter";
import { decodeXPageMap, decodeXPageToken, nextXPageCursor, nextXPageMapCursor, X_PAGE_MAP_FETCH_LIMIT, X_TWEET_ID } from "@/social/x/paging";

const mentionsSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string().min(1),
        text: z.string(),
        author_id: z.string().optional(),
        created_at: z.string().optional(),
      }),
    )
    .optional(),
  includes: z
    .object({
      users: z
        .array(
          z.object({
            id: z.string(),
            username: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  meta: z
    .object({
      newest_id: z.string().optional(),
      next_token: z.string().optional(),
    })
    .optional(),
});

const dmEventsSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string().min(1),
        text: z.string().optional(),
        sender_id: z.string().optional(),
        created_at: z.string().optional(),
        dm_conversation_id: z.string().optional(),
      }),
    )
    .optional(),
  includes: z
    .object({
      users: z
        .array(
          z.object({
            id: z.string(),
            username: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  meta: z
    .object({
      next_token: z.string().optional(),
    })
    .optional(),
});

const meSchema = z.object({
  data: z.object({
    id: z.string().min(1),
    username: z.string().optional(),
  }),
});

export function parseXInboxCursor(cursor?: string | null): { mentions: string | null; dms: string | null } {
  const value = cursor?.trim() || null;
  if (!value) {
    return { mentions: null, dms: null };
  }
  if (/^\d+$/.test(value)) {
    return { mentions: value, dms: null };
  }
  const named = parseNamedInboxCursor(value);
  return {
    mentions: named.mentions ?? null,
    dms: named.dms ?? null,
  };
}

export function newestXDirectMessageEventId(payload: unknown): string | null {
  const parsed = dmEventsSchema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }
  return (parsed.data.data ?? []).reduce<string | null>(
    (newest, event) => laterDigitId(newest, event.id),
    null,
  );
}

export function parseXDirectMessageEvents(
  payload: unknown,
  ownUserId: string,
  sinceEventId?: string | null,
): InboxMessage[] {
  const parsed = dmEventsSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("X dm_events returned an unexpected payload");
  }

  const users = new Map((parsed.data.includes?.users ?? []).map((user) => [user.id, user]));
  const messages: InboxMessage[] = [];
  for (const event of parsed.data.data ?? []) {
    if (!event.sender_id || event.sender_id === ownUserId) {
      continue;
    }
    if (!isDigitIdAfter(event.id, sinceEventId)) {
      continue;
    }
    const text = event.text?.trim();
    if (!text) {
      continue;
    }
    const sender = users.get(event.sender_id);
    messages.push({
      externalId: event.id,
      externalProfileId: event.sender_id,
      username: sender?.username ? `@${sender.username}` : null,
      body: text,
      url: null,
      receivedAt: event.created_at ?? new Date().toISOString(),
      replyKind: "direct_message",
    });
  }
  return messages;
}

export function parseXMentionTweets(payload: unknown, ownUserId: string): InboxMessage[] {
  const parsed = mentionsSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("X mentions returned an unexpected payload");
  }

  const users = new Map((parsed.data.includes?.users ?? []).map((user) => [user.id, user]));
  const messages: InboxMessage[] = [];
  for (const tweet of parsed.data.data ?? []) {
    if (!tweet.author_id || tweet.author_id === ownUserId) {
      continue;
    }
    const author = users.get(tweet.author_id);
    const username = author?.username ? `@${author.username}` : null;
    messages.push({
      externalId: tweet.id,
      externalProfileId: tweet.author_id,
      username,
      body: tweet.text,
      url: author?.username
        ? `https://x.com/${author.username}/status/${tweet.id}`
        : `https://x.com/i/web/status/${tweet.id}`,
      receivedAt: tweet.created_at ?? new Date().toISOString(),
      replyKind: "mention",
    });
  }
  return messages;
}

const userTweetsSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string().min(1),
      }),
    )
    .optional(),
  meta: z
    .object({
      next_token: z.string().optional(),
    })
    .optional(),
});

function xNextToken(meta?: { next_token?: string }): string | null {
  const token = meta?.next_token?.trim();
  return token ? token : null;
}

async function collectXMentions(
  accessToken: string,
  userId: string,
  input: { sinceId?: string | null; paginationToken?: string | null },
): Promise<{ messages: InboxMessage[]; newestId: string | null; nextToken: string | null }> {
  const url = new URL(`https://api.x.com/2/users/${userId}/mentions`);
  url.searchParams.set("max_results", "10");
  url.searchParams.set("tweet.fields", "author_id,created_at");
  url.searchParams.set("expansions", "author_id");
  url.searchParams.set("user.fields", "username");
  if (input.paginationToken) {
    url.searchParams.set("pagination_token", input.paginationToken);
  } else if (input.sinceId && /^\d+$/.test(input.sinceId)) {
    url.searchParams.set("since_id", input.sinceId);
  }
  const response = await socialFetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  const payload = await readJson<unknown>(response);
  const parsed = mentionsSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("X mentions returned an unexpected payload");
  }
  return {
    messages: parseXMentionTweets(payload, userId),
    newestId: parsed.data.meta?.newest_id ?? null,
    nextToken: xNextToken(parsed.data.meta),
  };
}

async function collectXDirectMessages(
  accessToken: string,
  ownUserId: string,
  input: { sinceEventId?: string | null; paginationToken?: string | null },
): Promise<{ messages: InboxMessage[]; newestId: string | null; nextToken: string | null }> {
  const url = new URL("https://api.x.com/2/dm_events");
  url.searchParams.set("event_types", "MessageCreate");
  url.searchParams.set("max_results", "50");
  url.searchParams.set("dm_event.fields", "id,text,created_at,sender_id,dm_conversation_id");
  url.searchParams.set("expansions", "sender_id");
  url.searchParams.set("user.fields", "username");
  if (input.paginationToken) {
    url.searchParams.set("pagination_token", input.paginationToken);
  }
  const response = await socialFetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  const payload = await readJson<unknown>(response);
  const parsed = dmEventsSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("X dm_events returned an unexpected payload");
  }
  return {
    messages: parseXDirectMessageEvents(payload, ownUserId, input.paginationToken ? null : input.sinceEventId),
    newestId: newestXDirectMessageEventId(payload),
    nextToken: xNextToken(parsed.data.meta),
  };
}

async function collectXUserTweets(
  accessToken: string,
  userId: string,
  paginationToken?: string | null,
): Promise<{ tweetIds: string[]; nextToken: string | null }> {
  const url = new URL(`https://api.x.com/2/users/${userId}/tweets`);
  url.searchParams.set("max_results", "10");
  url.searchParams.set("exclude", "retweets");
  if (paginationToken) {
    url.searchParams.set("pagination_token", paginationToken);
  }
  const response = await socialFetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  const payload = await readJson<unknown>(response);
  const parsed = userTweetsSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("X user tweets returned an unexpected payload");
  }
  return {
    tweetIds: (parsed.data.data ?? []).map((tweet) => tweet.id).filter((id) => X_TWEET_ID.test(id)),
    nextToken: xNextToken(parsed.data.meta),
  };
}

export const X_RECENT_SEARCH_INBOX_URL = "https://api.x.com/2/tweets/search/recent";

function xConversationReplyQuery(tweetId: string): string {
  return `conversation_id:${tweetId} is:reply`;
}

async function collectXQuotesForTweet(
  accessToken: string,
  ownUserId: string,
  tweetId: string,
  paginationToken?: string | null,
): Promise<{ messages: InboxMessage[]; newestId: string | null; nextToken: string | null }> {
  const url = new URL(`https://api.x.com/2/tweets/${tweetId}/quote_tweets`);
  url.searchParams.set("max_results", "10");
  url.searchParams.set("tweet.fields", "author_id,created_at");
  url.searchParams.set("expansions", "author_id");
  url.searchParams.set("user.fields", "username");
  if (paginationToken) {
    url.searchParams.set("pagination_token", paginationToken);
  }
  const response = await socialFetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  const payload = await readJson<unknown>(response);
  const parsed = mentionsSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("X quote tweets returned an unexpected payload");
  }
  const messages = parseXMentionTweets(payload, ownUserId);
  return {
    messages,
    newestId: messages.reduce<string | null>((newest, message) => laterDigitId(newest, message.externalId), null),
    nextToken: xNextToken(parsed.data.meta),
  };
}

async function collectXQuotesForTweets(
  accessToken: string,
  ownUserId: string,
  tweetIds: string[],
): Promise<{
  messages: InboxMessage[];
  newestId: string | null;
  quoteTokens: Record<string, string>;
}> {
  const pages = await Promise.all(
    tweetIds.map((tweetId) => collectXQuotesForTweet(accessToken, ownUserId, tweetId)),
  );
  const quoteTokens: Record<string, string> = {};
  const messages: InboxMessage[] = [];
  let newestId: string | null = null;
  for (const [index, page] of pages.entries()) {
    const tweetId = tweetIds[index];
    if (tweetId && page.nextToken) {
      quoteTokens[tweetId] = page.nextToken;
    }
    messages.push(...page.messages);
    newestId = laterDigitId(newestId, page.newestId);
  }
  return { messages, newestId, quoteTokens };
}

async function collectXQuotePages(
  accessToken: string,
  ownUserId: string,
  stored: Record<string, string>,
): Promise<{
  messages: InboxMessage[];
  newestId: string | null;
  nextTokens: Record<string, string>;
  fetchedIds: string[];
}> {
  const fetchedIds = Object.keys(stored)
    .filter((id) => X_TWEET_ID.test(id))
    .slice(0, X_PAGE_MAP_FETCH_LIMIT);
  const pages = await Promise.all(
    fetchedIds.map((tweetId) => collectXQuotesForTweet(accessToken, ownUserId, tweetId, stored[tweetId])),
  );
  const nextTokens: Record<string, string> = {};
  const messages: InboxMessage[] = [];
  let newestId: string | null = null;
  for (const [index, page] of pages.entries()) {
    const tweetId = fetchedIds[index];
    if (tweetId && page.nextToken) {
      nextTokens[tweetId] = page.nextToken;
    }
    messages.push(...page.messages);
    newestId = laterDigitId(newestId, page.newestId);
  }
  return { messages, newestId, nextTokens, fetchedIds };
}

async function collectXRepliesForTweet(
  accessToken: string,
  ownUserId: string,
  tweetId: string,
  paginationToken?: string | null,
): Promise<{ messages: InboxMessage[]; newestId: string | null; nextToken: string | null }> {
  if (!X_TWEET_ID.test(tweetId)) {
    return { messages: [], newestId: null, nextToken: null };
  }
  const url = new URL(X_RECENT_SEARCH_INBOX_URL);
  url.searchParams.set("query", xConversationReplyQuery(tweetId));
  url.searchParams.set("max_results", "10");
  url.searchParams.set("tweet.fields", "author_id,created_at");
  url.searchParams.set("expansions", "author_id");
  url.searchParams.set("user.fields", "username");
  if (paginationToken) {
    url.searchParams.set("pagination_token", paginationToken);
  }
  const response = await socialFetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  const payload = await readJson<unknown>(response);
  const parsed = mentionsSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("X conversation replies returned an unexpected payload");
  }
  const messages = parseXMentionTweets(payload, ownUserId);
  return {
    messages,
    newestId: messages.reduce<string | null>((newest, message) => laterDigitId(newest, message.externalId), null),
    nextToken: xNextToken(parsed.data.meta),
  };
}

async function collectXRepliesForTweets(
  accessToken: string,
  ownUserId: string,
  tweetIds: string[],
): Promise<{
  messages: InboxMessage[];
  newestId: string | null;
  replyTokens: Record<string, string>;
}> {
  const pages = await Promise.all(
    tweetIds.map((tweetId) => collectXRepliesForTweet(accessToken, ownUserId, tweetId)),
  );
  const replyTokens: Record<string, string> = {};
  const messages: InboxMessage[] = [];
  let newestId: string | null = null;
  for (const [index, page] of pages.entries()) {
    const tweetId = tweetIds[index];
    if (tweetId && page.nextToken) {
      replyTokens[tweetId] = page.nextToken;
    }
    messages.push(...page.messages);
    newestId = laterDigitId(newestId, page.newestId);
  }
  return { messages, newestId, replyTokens };
}

async function collectXReplyPages(
  accessToken: string,
  ownUserId: string,
  stored: Record<string, string>,
): Promise<{
  messages: InboxMessage[];
  newestId: string | null;
  nextTokens: Record<string, string>;
  fetchedIds: string[];
}> {
  const fetchedIds = Object.keys(stored)
    .filter((id) => X_TWEET_ID.test(id))
    .slice(0, X_PAGE_MAP_FETCH_LIMIT);
  const pages = await Promise.all(
    fetchedIds.map((tweetId) => collectXRepliesForTweet(accessToken, ownUserId, tweetId, stored[tweetId])),
  );
  const nextTokens: Record<string, string> = {};
  const messages: InboxMessage[] = [];
  let newestId: string | null = null;
  for (const [index, page] of pages.entries()) {
    const tweetId = fetchedIds[index];
    if (tweetId && page.nextToken) {
      nextTokens[tweetId] = page.nextToken;
    }
    messages.push(...page.messages);
    newestId = laterDigitId(newestId, page.newestId);
  }
  return { messages, newestId, nextTokens, fetchedIds };
}

function filterXQuotesAfterCursor(messages: InboxMessage[], sinceId?: string | null): InboxMessage[] {
  if (!sinceId) {
    return messages;
  }
  return messages.filter((message) => isDigitIdAfter(message.externalId, sinceId));
}

export async function collectXInbox(accessToken: string, input: InboxInput): Promise<InboxResult> {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const meResponse = await socialFetch("https://api.x.com/2/users/me", { headers });
  const me = meSchema.safeParse(await readJson<unknown>(meResponse));
  if (!me.success) {
    throw new AuthenticationError("X users/me failed");
  }

  const named = parseNamedInboxCursor(input.cursor);
  const cursor = parseXInboxCursor(input.cursor);
  const olderMentionToken = decodeXPageToken(named.mentionpages);
  const olderDmToken = decodeXPageToken(named.dmpages);
  const olderTweetToken = decodeXPageToken(named.tweetpages);
  const storedQuotePages = decodeXPageMap(named.quotepages);
  const storedReplyPages = decodeXPageMap(named.replypages);
  const emptyPage = { messages: [] as InboxMessage[], newestId: null as string | null, nextToken: null as string | null };
  const emptyTweets = { tweetIds: [] as string[], nextToken: null as string | null };
  const emptyQuotes = {
    messages: [] as InboxMessage[],
    newestId: null as string | null,
    quoteTokens: {} as Record<string, string>,
  };
  const emptyReplies = {
    messages: [] as InboxMessage[],
    newestId: null as string | null,
    replyTokens: {} as Record<string, string>,
  };
  const emptyQuotePages = {
    messages: [] as InboxMessage[],
    newestId: null as string | null,
    nextTokens: {} as Record<string, string>,
    fetchedIds: [] as string[],
  };
  const userId = me.data.data.id;
  const [
    latestMentions,
    olderMentions,
    latestDms,
    olderDms,
    latestTweets,
    olderTweets,
    extraQuotes,
    extraReplies,
  ] = await Promise.all([
    collectXMentions(accessToken, userId, { sinceId: cursor.mentions }),
    olderMentionToken
      ? collectXMentions(accessToken, userId, { paginationToken: olderMentionToken })
      : Promise.resolve(emptyPage),
    collectXDirectMessages(accessToken, userId, { sinceEventId: cursor.dms }),
    olderDmToken
      ? collectXDirectMessages(accessToken, userId, { paginationToken: olderDmToken })
      : Promise.resolve(emptyPage),
    collectXUserTweets(accessToken, userId),
    olderTweetToken ? collectXUserTweets(accessToken, userId, olderTweetToken) : Promise.resolve(emptyTweets),
    storedQuotePages
      ? collectXQuotePages(accessToken, userId, storedQuotePages)
      : Promise.resolve(emptyQuotePages),
    storedReplyPages
      ? collectXReplyPages(accessToken, userId, storedReplyPages)
      : Promise.resolve(emptyQuotePages),
  ]);
  const [latestQuotes, olderQuotes, latestReplies, olderReplies] = await Promise.all([
    collectXQuotesForTweets(accessToken, userId, latestTweets.tweetIds),
    olderTweets.tweetIds.length > 0
      ? collectXQuotesForTweets(accessToken, userId, olderTweets.tweetIds)
      : Promise.resolve(emptyQuotes),
    collectXRepliesForTweets(accessToken, userId, latestTweets.tweetIds),
    olderTweets.tweetIds.length > 0
      ? collectXRepliesForTweets(accessToken, userId, olderTweets.tweetIds)
      : Promise.resolve(emptyReplies),
  ]);

  return {
    messages: [
      ...uniqueInboxMessages([
        ...latestMentions.messages,
        ...olderMentions.messages,
        ...filterXQuotesAfterCursor(latestQuotes.messages, named.quotes),
        ...olderQuotes.messages,
        ...extraQuotes.messages,
        ...filterXQuotesAfterCursor(latestReplies.messages, named.replies),
        ...olderReplies.messages,
        ...extraReplies.messages,
      ]),
      ...uniqueInboxMessages([...latestDms.messages, ...olderDms.messages]),
    ],
    cursor: serializeNamedInboxCursor({
      dmpages: nextXPageCursor({
        stored: named.dmpages,
        firstPageToken: latestDms.nextToken,
        olderPageToken: olderDms.nextToken,
        fetchedOlder: Boolean(olderDmToken),
      }),
      dms: laterDigitId(cursor.dms, laterDigitId(latestDms.newestId, olderDms.newestId)) ?? "",
      mentionpages: nextXPageCursor({
        stored: named.mentionpages,
        firstPageToken: latestMentions.nextToken,
        olderPageToken: olderMentions.nextToken,
        fetchedOlder: Boolean(olderMentionToken),
      }),
      mentions: laterDigitId(cursor.mentions, laterDigitId(latestMentions.newestId, olderMentions.newestId)) ?? "",
      quotepages: nextXPageMapCursor({
        stored: named.quotepages,
        nestedTokens: { ...latestQuotes.quoteTokens, ...olderQuotes.quoteTokens },
        fetchedNextTokens: extraQuotes.nextTokens,
        fetchedIds: extraQuotes.fetchedIds,
      }),
      quotes:
        laterDigitId(
          named.quotes,
          laterDigitId(latestQuotes.newestId, laterDigitId(olderQuotes.newestId, extraQuotes.newestId)),
        ) ?? "",
      replies:
        laterDigitId(
          named.replies,
          laterDigitId(latestReplies.newestId, laterDigitId(olderReplies.newestId, extraReplies.newestId)),
        ) ?? "",
      replypages: nextXPageMapCursor({
        stored: named.replypages,
        nestedTokens: { ...latestReplies.replyTokens, ...olderReplies.replyTokens },
        fetchedNextTokens: extraReplies.nextTokens,
        fetchedIds: extraReplies.fetchedIds,
      }),
      tweetpages: nextXPageCursor({
        stored: named.tweetpages,
        firstPageToken: latestTweets.nextToken,
        olderPageToken: olderTweets.nextToken,
        fetchedOlder: Boolean(olderTweetToken),
      }),
    }),
  };
}

const tweetReplySchema = z.object({
  data: z.object({
    id: z.string().min(1),
  }),
});

export function xMentionReplyUrl(): string {
  return "https://api.x.com/2/tweets";
}

export async function sendXMentionReply(
  accessToken: string,
  input: { tweetId: string; text: string },
): Promise<{ externalMessageId: string }> {
  const text = input.text.trim();
  if (!text) {
    throw new ValidationError("X mention replies require a body");
  }
  if (!input.tweetId.trim()) {
    throw new ValidationError("X mention replies require the source tweet id");
  }

  const response = await socialFetch(xMentionReplyUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      reply: { in_reply_to_tweet_id: input.tweetId },
    }),
  });
  const parsed = tweetReplySchema.safeParse(await readJson<unknown>(response));
  if (!parsed.success) {
    throw new SocialError("X mention reply returned an unexpected payload");
  }
  return { externalMessageId: parsed.data.data.id };
}

