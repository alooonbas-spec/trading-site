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
import { decodeXPageToken, nextXPageCursor } from "@/social/x/paging";

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
  const emptyPage = { messages: [] as InboxMessage[], newestId: null as string | null, nextToken: null as string | null };
  const userId = me.data.data.id;
  const [latestMentions, olderMentions, latestDms, olderDms] = await Promise.all([
    collectXMentions(accessToken, userId, { sinceId: cursor.mentions }),
    olderMentionToken
      ? collectXMentions(accessToken, userId, { paginationToken: olderMentionToken })
      : Promise.resolve(emptyPage),
    collectXDirectMessages(accessToken, userId, { sinceEventId: cursor.dms }),
    olderDmToken
      ? collectXDirectMessages(accessToken, userId, { paginationToken: olderDmToken })
      : Promise.resolve(emptyPage),
  ]);

  return {
    messages: [
      ...uniqueInboxMessages([...latestMentions.messages, ...olderMentions.messages]),
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

