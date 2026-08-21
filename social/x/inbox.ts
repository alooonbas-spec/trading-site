import { z } from "zod";
import { AuthenticationError, SocialError } from "@/lib/errors";
import { readJson, socialFetch } from "@/social/core/http";
import type { InboxInput, InboxMessage, InboxResult } from "@/social/core/adapter";

const mentionsSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string().min(1),
        text: z.string(),
        author_id: z.string().optional(),
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
});

const meSchema = z.object({
  data: z.object({
    id: z.string().min(1),
    username: z.string().optional(),
  }),
});

export function parseXDirectMessageEvents(payload: unknown, ownUserId: string): InboxMessage[] {
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
    });
  }
  return messages;
}

export async function collectXInbox(accessToken: string, input: InboxInput): Promise<InboxResult> {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const meResponse = await socialFetch("https://api.x.com/2/users/me", { headers });
  const me = meSchema.safeParse(await readJson<unknown>(meResponse));
  if (!me.success) {
    throw new AuthenticationError("X users/me failed");
  }

  const mentionsUrl = new URL(`https://api.x.com/2/users/${me.data.data.id}/mentions`);
  mentionsUrl.searchParams.set("max_results", "10");
  mentionsUrl.searchParams.set("tweet.fields", "author_id,created_at");
  mentionsUrl.searchParams.set("expansions", "author_id");
  mentionsUrl.searchParams.set("user.fields", "username");
  if (input.cursor && /^\d+$/.test(input.cursor)) {
    mentionsUrl.searchParams.set("since_id", input.cursor);
  }

  const dmUrl = new URL("https://api.x.com/2/dm_events");
  dmUrl.searchParams.set("event_types", "MessageCreate");
  dmUrl.searchParams.set("max_results", "50");
  dmUrl.searchParams.set("dm_event.fields", "id,text,created_at,sender_id,dm_conversation_id");
  dmUrl.searchParams.set("expansions", "sender_id");
  dmUrl.searchParams.set("user.fields", "username");

  const [mentionsResponse, dmResponse] = await Promise.all([
    socialFetch(mentionsUrl.toString(), { headers }),
    socialFetch(dmUrl.toString(), { headers }),
  ]);

  const parsed = mentionsSchema.safeParse(await readJson<unknown>(mentionsResponse));
  if (!parsed.success) {
    throw new SocialError("X mentions returned an unexpected payload");
  }

  const users = new Map((parsed.data.includes?.users ?? []).map((user) => [user.id, user]));
  const mentionMessages: InboxMessage[] = [];
  for (const tweet of parsed.data.data ?? []) {
    if (!tweet.author_id || tweet.author_id === me.data.data.id) {
      continue;
    }
    const author = users.get(tweet.author_id);
    const username = author?.username ? `@${author.username}` : null;
    mentionMessages.push({
      externalId: tweet.id,
      externalProfileId: tweet.author_id,
      username,
      body: tweet.text,
      url: author?.username
        ? `https://x.com/${author.username}/status/${tweet.id}`
        : `https://x.com/i/web/status/${tweet.id}`,
      receivedAt: new Date().toISOString(),
    });
  }

  const dmMessages = parseXDirectMessageEvents(await readJson<unknown>(dmResponse), me.data.data.id);

  return {
    messages: [...mentionMessages, ...dmMessages],
    cursor: parsed.data.meta?.newest_id ?? input.cursor ?? null,
  };
}
