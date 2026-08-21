import { z } from "zod";
import { SocialError } from "@/lib/errors";
import { readJson, socialFetch } from "@/social/core/http";
import type { InboxInput, InboxResult } from "@/social/core/adapter";
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

export async function collectInstagramInbox(
  accessToken: string,
  metadata: Record<string, unknown> | undefined,
  input: InboxInput,
): Promise<InboxResult> {
  const userId = await resolveInstagramUserId(accessToken, metadata);
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

  const messages = [];
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

  return {
    messages,
    cursor: input.cursor ?? null,
  };
}
