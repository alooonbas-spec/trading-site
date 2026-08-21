import { z } from "zod";
import { SocialError } from "@/lib/errors";
import { readJson, socialFetch } from "@/social/core/http";
import type { InboxInput, InboxResult } from "@/social/core/adapter";
import { FACEBOOK_GRAPH_ORIGIN } from "@/social/facebook/graph";
import { resolveFacebookPage } from "@/social/facebook/pages";
import { throwIfGraphError } from "@/social/meta/graph-error";

const commentsSchema = z.object({
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
                  message: z.string().optional(),
                  created_time: z.string().optional(),
                  from: z
                    .object({
                      id: z.string().optional(),
                      name: z.string().optional(),
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

export async function collectFacebookInbox(
  userAccessToken: string,
  metadata: Record<string, unknown> | undefined,
  input: InboxInput,
): Promise<InboxResult> {
  const page = await resolveFacebookPage(userAccessToken, metadata);
  const url = new URL(`${FACEBOOK_GRAPH_ORIGIN}/${page.id}/feed`);
  url.searchParams.set("fields", "id,comments.limit(50){id,from,message,created_time}");
  url.searchParams.set("limit", "10");
  url.searchParams.set("access_token", page.accessToken);
  const response = await socialFetch(url.toString());
  const payload = await readJson<unknown>(response);
  throwIfGraphError(payload);
  const parsed = commentsSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("Facebook Page comments returned an unexpected payload");
  }

  const messages = [];
  for (const post of parsed.data.data ?? []) {
    for (const comment of post.comments?.data ?? []) {
      const fromId = comment.from?.id;
      const text = comment.message?.trim();
      if (!fromId || !text || fromId === page.id) {
        continue;
      }
      messages.push({
        externalId: comment.id,
        externalProfileId: fromId,
        username: comment.from?.name ?? null,
        body: text,
        url: `https://www.facebook.com/${comment.id}`,
        receivedAt: comment.created_time ?? null,
      });
    }
  }

  return {
    messages,
    cursor: input.cursor ?? null,
  };
}
