import { z } from "zod";
import { SocialError, ValidationError } from "@/lib/errors";
import { readJson, socialFetch } from "@/social/core/http";
import type { InboxInput, InboxMessage, InboxResult } from "@/social/core/adapter";
import { FACEBOOK_GRAPH_ORIGIN } from "@/social/facebook/graph";
import { resolveFacebookPage, type FacebookPageAuth } from "@/social/facebook/pages";
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

export function parseFacebookMessengerConversations(payload: unknown, pageId: string): InboxMessage[] {
  const parsed = conversationsSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("Facebook Page conversations returned an unexpected payload");
  }

  const messages: InboxMessage[] = [];
  for (const thread of parsed.data.data ?? []) {
    for (const event of thread.messages?.data ?? []) {
      const fromId = event.from?.id !== undefined ? String(event.from.id) : "";
      const text = event.message?.trim();
      if (!fromId || !text || fromId === pageId) {
        continue;
      }
      messages.push({
        externalId: event.id,
        externalProfileId: fromId,
        username: event.from?.name ?? null,
        body: text,
        url: null,
        receivedAt: event.created_time ?? null,
        replyKind: "direct_message",
      });
    }
  }
  return messages;
}

async function collectFacebookComments(page: FacebookPageAuth): Promise<InboxMessage[]> {
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

  const messages: InboxMessage[] = [];
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
        replyKind: "comment",
      });
    }
  }
  return messages;
}

async function collectFacebookMessenger(page: FacebookPageAuth): Promise<InboxMessage[]> {
  const url = new URL(`${FACEBOOK_GRAPH_ORIGIN}/${page.id}/conversations`);
  url.searchParams.set("platform", "MESSENGER");
  url.searchParams.set("fields", "id,messages.limit(20){id,message,from,created_time}");
  url.searchParams.set("limit", "15");
  url.searchParams.set("access_token", page.accessToken);
  const response = await socialFetch(url.toString());
  const payload = await readJson<unknown>(response);
  throwIfGraphError(payload);
  return parseFacebookMessengerConversations(payload, page.id);
}

export async function collectFacebookInbox(
  userAccessToken: string,
  metadata: Record<string, unknown> | undefined,
  input: InboxInput,
): Promise<InboxResult> {
  const page = await resolveFacebookPage(userAccessToken, metadata);
  const [comments, directMessages] = await Promise.all([
    collectFacebookComments(page),
    collectFacebookMessenger(page),
  ]);
  return {
    messages: [...comments, ...directMessages],
    cursor: input.cursor ?? null,
  };
}

const commentReplySchema = z.object({
  id: z.string().min(1),
});

export function facebookCommentReplyUrl(commentId: string): string {
  return `${FACEBOOK_GRAPH_ORIGIN}/${commentId}/comments`;
}

export async function replyToFacebookComment(
  page: FacebookPageAuth,
  input: { commentId: string; text: string },
): Promise<{ externalMessageId: string }> {
  const text = input.text.trim();
  if (!text) {
    throw new ValidationError("Facebook comment replies require a body");
  }
  if (!input.commentId.trim()) {
    throw new ValidationError("Facebook comment replies require the source comment id");
  }

  const url = new URL(facebookCommentReplyUrl(input.commentId));
  url.searchParams.set("access_token", page.accessToken);
  const response = await socialFetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: text }),
  });
  const payload = await readJson<unknown>(response);
  throwIfGraphError(payload);
  const parsed = commentReplySchema.safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("Facebook comment reply returned an unexpected payload");
  }
  return { externalMessageId: parsed.data.id };
}

