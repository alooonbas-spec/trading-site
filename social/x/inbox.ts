import { z } from "zod";
import { AuthenticationError, SocialError } from "@/lib/errors";
import { readJson, socialFetch } from "@/social/core/http";
import type { InboxInput, InboxResult } from "@/social/core/adapter";

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

const meSchema = z.object({
  data: z.object({
    id: z.string().min(1),
    username: z.string().optional(),
  }),
});

export async function collectXInbox(accessToken: string, input: InboxInput): Promise<InboxResult> {
  const meResponse = await socialFetch("https://api.x.com/2/users/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const me = meSchema.safeParse(await readJson<unknown>(meResponse));
  if (!me.success) {
    throw new AuthenticationError("X users/me failed");
  }

  const url = new URL(`https://api.x.com/2/users/${me.data.data.id}/mentions`);
  url.searchParams.set("max_results", "10");
  url.searchParams.set("tweet.fields", "author_id,created_at");
  url.searchParams.set("expansions", "author_id");
  url.searchParams.set("user.fields", "username");
  if (input.cursor && /^\d+$/.test(input.cursor)) {
    url.searchParams.set("since_id", input.cursor);
  }

  const response = await socialFetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const parsed = mentionsSchema.safeParse(await readJson<unknown>(response));
  if (!parsed.success) {
    throw new SocialError("X mentions returned an unexpected payload");
  }

  const users = new Map((parsed.data.includes?.users ?? []).map((user) => [user.id, user]));
  const messages = [];
  for (const tweet of parsed.data.data ?? []) {
    if (!tweet.author_id || tweet.author_id === me.data.data.id) {
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
      receivedAt: new Date().toISOString(),
    });
  }

  return {
    messages,
    cursor: parsed.data.meta?.newest_id ?? input.cursor ?? null,
  };
}
