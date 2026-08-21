import { z } from "zod";
import { SocialError } from "@/lib/errors";
import { readJson, socialFetch } from "@/social/core/http";
import type { InboxInput, InboxMessage, InboxResult } from "@/social/core/adapter";
import { INSTAGRAM_GRAPH_ORIGIN, resolveInstagramUserId } from "@/social/instagram/publish";
import { throwIfGraphError } from "@/social/meta/graph-error";

const mediaCommentsSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string().min(1),
        comments: z
          .object({
            data: z
              .array(
                z.object({
                  id: z.string().min(1),
                  text: z.string().optional(),
                  username: z.string().optional(),
                  timestamp: z.string().optional(),
                  from: z
                    .object({
                      id: z.union([z.string(), z.number()]).optional(),
                      username: z.string().optional(),
                    })
                    .optional(),
                }),
              )
              .optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

const conversationsSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string().optional(),
        messages: z
          .object({
            data: z
              .array(
                z.object({
                  id: z.string().min(1),
                  message: z.string().optional(),
                  created_time: z.string().optional(),
                  from: z
                    .object({
                      id: z.union([z.string(), z.number()]).optional(),
                      username: z.string().optional(),
                    })
                    .optional(),
                }),
              )
              .optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

export function parseInstagramDirectConversations(payload: unknown, ownUserId: string): InboxMessage[] {
  const parsed = conversationsSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("Instagram conversations returned an unexpected payload");
  }

  const messages: InboxMessage[] = [];
  for (const thread of parsed.data.data ?? []) {
    for (const event of thread.messages?.data ?? []) {
      const fromId = event.from?.id !== undefined ? String(event.from.id) : "";
      const text = event.message?.trim();
      if (!fromId || !text || fromId === ownUserId) {
        continue;
      }
      const username = event.from?.username ? `@${event.from.username.replace(/^@/, "")}` : null;
      messages.push({
        externalId: event.id,
        externalProfileId: fromId,
        username,
        body: text,
        url: null,
        receivedAt: event.created_time ?? null,
      });
    }
  }
  return messages;
}

async function collectInstagramComments(accessToken: string, userId: string): Promise<InboxMessage[]> {
  const url = new URL(`${INSTAGRAM_GRAPH_ORIGIN}/${userId}/media`);
  url.searchParams.set("fields", "id,comments{id,text,username,timestamp,from}");
  url.searchParams.set("limit", "10");
  url.searchParams.set("access_token", accessToken);
  const response = await socialFetch(url.toString());
  const payload = await readJson<unknown>(response);
  throwIfGraphError(payload);
  const parsed = mediaCommentsSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("Instagram media comments returned an unexpected payload");
  }

  const messages: InboxMessage[] = [];
  for (const media of parsed.data.data ?? []) {
    for (const comment of media.comments?.data ?? []) {
      const text = comment.text?.trim();
      const username = comment.from?.username ?? comment.username;
      const fromId = comment.from?.id !== undefined ? String(comment.from.id) : username;
      if (!text || !fromId) {
        continue;
      }
      messages.push({
        externalId: comment.id,
        externalProfileId: fromId,
        username: username ? `@${username.replace(/^@/, "")}` : null,
        body: text,
        url: `https://www.instagram.com/p/${media.id}/`,
        receivedAt: comment.timestamp ?? null,
      });
    }
  }
  return messages;
}

async function collectInstagramDirectMessages(accessToken: string, userId: string): Promise<InboxMessage[]> {
  const url = new URL(`${INSTAGRAM_GRAPH_ORIGIN}/${userId}/conversations`);
  url.searchParams.set("platform", "instagram");
  url.searchParams.set("fields", "id,messages.limit(20){id,created_time,from,message}");
  url.searchParams.set("limit", "15");
  url.searchParams.set("access_token", accessToken);
  const response = await socialFetch(url.toString());
  const payload = await readJson<unknown>(response);
  throwIfGraphError(payload);
  return parseInstagramDirectConversations(payload, userId);
}

export async function collectInstagramInbox(
  accessToken: string,
  metadata: Record<string, unknown> | undefined,
  input: InboxInput,
): Promise<InboxResult> {
  const userId = await resolveInstagramUserId(accessToken, metadata);
  const [comments, directMessages] = await Promise.all([
    collectInstagramComments(accessToken, userId),
    collectInstagramDirectMessages(accessToken, userId),
  ]);
  return {
    messages: [...comments, ...directMessages],
    cursor: input.cursor ?? null,
  };
}
