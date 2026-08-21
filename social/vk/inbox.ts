import { z } from "zod";
import { SocialError, ValidationError } from "@/lib/errors";
import type { InboxInput, InboxMessage, InboxResult } from "@/social/core/adapter";
import { vkCall } from "@/social/vk/api";
import { vkWallTarget } from "@/social/vk/publish";

const wallGetSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.number(),
        owner_id: z.number().optional(),
      }),
    )
    .optional(),
});

const wallCommentsSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.number(),
        from_id: z.number().optional(),
        text: z.string().optional(),
        date: z.number().optional(),
      }),
    )
    .optional(),
});

export async function collectVkInbox(
  accessToken: string,
  metadata: Record<string, unknown> | undefined,
  input: InboxInput,
): Promise<InboxResult> {
  const target = vkWallTarget(metadata);
  const wallPayload = await vkCall("wall.get", {
    access_token: accessToken,
    count: "10",
    filter: "owner",
    ...(target.ownerId ? { owner_id: target.ownerId } : {}),
  });
  const wall = wallGetSchema.safeParse(wallPayload);
  if (!wall.success) {
    throw new SocialError("VK wall.get returned an unexpected payload");
  }

  const messages: InboxMessage[] = [];
  for (const post of wall.data.items ?? []) {
    const commentsPayload = await vkCall("wall.getComments", {
      access_token: accessToken,
      post_id: String(post.id),
      count: "50",
      sort: "desc",
      ...(target.ownerId ? { owner_id: target.ownerId } : {}),
    });
    const comments = wallCommentsSchema.safeParse(commentsPayload);
    if (!comments.success) {
      throw new SocialError("VK wall.getComments returned an unexpected payload");
    }
    const ownerId = post.owner_id ?? (target.ownerId ? Number(target.ownerId) : null);
    for (const comment of comments.data.items ?? []) {
      const text = comment.text?.trim();
      if (!text || comment.from_id === undefined || comment.from_id === ownerId) {
        continue;
      }
      messages.push({
        externalId: `${ownerId ?? ""}:${post.id}:${comment.id}`,
        externalProfileId: String(comment.from_id),
        username: null,
        body: text,
        url: ownerId ? `https://vk.com/wall${ownerId}_${post.id}?reply=${comment.id}` : null,
        receivedAt: comment.date ? new Date(comment.date * 1000).toISOString() : null,
        replyKind: "comment",
      });
    }
  }

  return {
    messages,
    cursor: input.cursor ?? null,
  };
}

const createCommentSchema = z.object({
  comment_id: z.number(),
});

export function parseVkInboxCommentRef(externalId: string): {
  ownerId: string;
  postId: string;
  commentId: string;
} {
  const parts = externalId.split(":");
  const ownerId = parts[0];
  const postId = parts[1];
  const commentId = parts[2];
  if (parts.length !== 3 || !ownerId || !postId || !commentId || !/^-?\d+$/.test(ownerId) || !/^\d+$/.test(postId) || !/^\d+$/.test(commentId)) {
    throw new ValidationError(
      "VK comment replies require owner, post, and comment ids from wall.getComments",
    );
  }
  return { ownerId, postId, commentId };
}

export async function replyToVkWallComment(
  accessToken: string,
  input: { externalId: string; text: string },
): Promise<{ externalMessageId: string }> {
  const text = input.text.trim();
  if (!text) {
    throw new ValidationError("VK comment replies require a body");
  }

  const ref = parseVkInboxCommentRef(input.externalId);
  const payload = await vkCall("wall.createComment", {
    access_token: accessToken,
    owner_id: ref.ownerId,
    post_id: ref.postId,
    reply_to_comment: ref.commentId,
    message: text,
  });
  const parsed = createCommentSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("VK wall.createComment returned an unexpected payload");
  }
  return { externalMessageId: String(parsed.data.comment_id) };
}

