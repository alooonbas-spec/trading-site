import { z } from "zod";
import { SocialError, ValidationError } from "@/lib/errors";
import {
  filterMessagesAfterCursor,
  isDigitIdAfter,
  isNamedInboxCursor,
  laterDigitId,
  parseNamedInboxCursor,
  serializeNamedInboxCursor,
} from "@/lib/inbox/cursor";
import type { InboxInput, InboxMessage, InboxResult } from "@/social/core/adapter";
import { vkCall } from "@/social/vk/api";
import { isVkCommunityAccount, vkCommunityGroupId } from "@/social/vk/community";
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

const conversationsSchema = z.object({
  items: z
    .array(
      z.object({
        conversation: z
          .object({
            peer: z
              .object({
                id: z.number(),
                type: z.string().optional(),
              })
              .optional(),
          })
          .optional(),
        last_message: z
          .object({
            id: z.number(),
            date: z.number().optional(),
            from_id: z.number().optional(),
            text: z.string().optional(),
            out: z.number().optional(),
          })
          .optional(),
      }),
    )
    .optional(),
  profiles: z
    .array(
      z.object({
        id: z.number(),
        screen_name: z.string().optional(),
        first_name: z.string().optional(),
        last_name: z.string().optional(),
      }),
    )
    .optional(),
});

export function parseVkInboxCursor(cursor?: string | null): {
  comments: string | null;
  messages: string | null;
} {
  const value = cursor?.trim();
  if (!value) {
    return { comments: null, messages: null };
  }
  if (isNamedInboxCursor(value)) {
    const named = parseNamedInboxCursor(value);
    return {
      comments: named.comments ?? null,
      messages: named.messages ?? null,
    };
  }
  if (/^\d{10}$/.test(value)) {
    return { comments: value, messages: null };
  }
  return { comments: null, messages: null };
}

export function parseVkCommunityConversations(
  payload: unknown,
  groupId: string,
): InboxMessage[] {
  const parsed = conversationsSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("VK messages.getConversations returned an unexpected payload");
  }

  const communityFromId = -Number(groupId);
  const profiles = new Map((parsed.data.profiles ?? []).map((profile) => [profile.id, profile]));
  const messages: InboxMessage[] = [];
  for (const item of parsed.data.items ?? []) {
    const peer = item.conversation?.peer;
    const last = item.last_message;
    if (!peer || peer.type === "chat" || !last) {
      continue;
    }
    const text = last.text?.trim();
    if (!text || last.out === 1 || last.from_id === undefined || last.from_id === communityFromId || last.from_id < 0) {
      continue;
    }
    const profile = profiles.get(last.from_id);
    const username = profile?.screen_name ? `@${profile.screen_name}` : null;
    messages.push({
      externalId: String(last.id),
      externalProfileId: String(last.from_id),
      username,
      body: text,
      url: null,
      receivedAt: last.date ? new Date(last.date * 1000).toISOString() : null,
      replyKind: "direct_message",
    });
  }
  return messages;
}

export async function collectVkInbox(
  accessToken: string,
  metadata: Record<string, unknown> | undefined,
  input: InboxInput,
): Promise<InboxResult> {
  if (isVkCommunityAccount(metadata)) {
    return collectVkCommunityInbox(accessToken, metadata ?? {}, input);
  }
  return collectVkWallCommentInbox(accessToken, metadata, input.cursor);
}

async function collectVkCommunityInbox(
  accessToken: string,
  metadata: Record<string, unknown>,
  input: InboxInput,
): Promise<InboxResult> {
  const groupId = vkCommunityGroupId(metadata);
  const cursor = parseVkInboxCursor(input.cursor);
  const [comments, directMessages] = await Promise.all([
    collectVkWallComments(accessToken, metadata),
    collectVkCommunityMessages(accessToken, groupId),
  ]);
  const newestMessageId = directMessages.reduce<string | null>(
    (newest, message) => laterDigitId(newest, message.externalId),
    null,
  );
  return {
    messages: [
      ...filterMessagesAfterCursor(comments, cursor.comments),
      ...directMessages.filter((message) => isDigitIdAfter(message.externalId, cursor.messages)),
    ],
    cursor: serializeNamedInboxCursor({
      comments: laterDigitId(cursor.comments, newestVkCommentUnix(comments)) ?? "",
      messages: laterDigitId(cursor.messages, newestMessageId) ?? "",
    }),
  };
}

async function collectVkWallCommentInbox(
  accessToken: string,
  metadata: Record<string, unknown> | undefined,
  cursor?: string | null,
): Promise<InboxResult> {
  const comments = await collectVkWallComments(accessToken, metadata);
  const watermark = parseVkInboxCursor(cursor).comments;
  return {
    messages: filterMessagesAfterCursor(comments, watermark),
    cursor: laterDigitId(watermark, newestVkCommentUnix(comments)),
  };
}

async function collectVkWallComments(
  accessToken: string,
  metadata: Record<string, unknown> | undefined,
): Promise<InboxMessage[]> {
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
  return messages;
}

async function collectVkCommunityMessages(accessToken: string, groupId: string): Promise<InboxMessage[]> {
  const payload = await vkCall("messages.getConversations", {
    access_token: accessToken,
    count: "20",
    filter: "all",
    extended: "1",
    group_id: groupId,
  });
  return parseVkCommunityConversations(payload, groupId);
}

function newestVkCommentUnix(messages: InboxMessage[]): string | null {
  return messages.reduce<string | null>((newest, message) => {
    if (!message.receivedAt) {
      return newest;
    }
    const seconds = String(Math.floor(new Date(message.receivedAt).getTime() / 1000));
    if (!/^\d{10}$/.test(seconds)) {
      return newest;
    }
    return laterDigitId(newest, seconds);
  }, null);
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
