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

const vkMessageItemSchema = z.object({
  id: z.number(),
  date: z.number().optional(),
  from_id: z.number().optional(),
  text: z.string().optional(),
  out: z.number().optional(),
  peer_id: z.number().optional(),
});

const vkProfilesSchema = z
  .array(
    z.object({
      id: z.number(),
      screen_name: z.string().optional(),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
    }),
  )
  .optional();

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
        last_message: vkMessageItemSchema.optional(),
      }),
    )
    .optional(),
  profiles: vkProfilesSchema,
});

const historySchema = z.object({
  items: z.array(vkMessageItemSchema).optional(),
  profiles: vkProfilesSchema,
});

const VK_COMMUNITY_HISTORY_COUNT = "50";
const VK_CHAT_PEER_FLOOR = 2_000_000_000;

export function parseVkInboxCursor(cursor?: string | null): {
  comments: string | null;
  messages: string | null;
  history: boolean;
} {
  const value = cursor?.trim();
  if (!value) {
    return { comments: null, messages: null, history: false };
  }
  if (isNamedInboxCursor(value)) {
    const named = parseNamedInboxCursor(value);
    return {
      comments: named.comments ?? null,
      messages: named.messages ?? null,
      history: named.history === "1",
    };
  }
  if (/^\d{10}$/.test(value)) {
    return { comments: value, messages: null, history: false };
  }
  return { comments: null, messages: null, history: false };
}

export function parseVkCommunityConversations(
  payload: unknown,
  groupId: string,
): InboxMessage[] {
  const parsed = conversationsSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("VK messages.getConversations returned an unexpected payload");
  }

  const profiles = profilesFromVk(parsed.data.profiles);
  const messages: InboxMessage[] = [];
  for (const item of parsed.data.items ?? []) {
    const peer = item.conversation?.peer;
    const last = item.last_message;
    if (!peer || !isVkUserPeer(peer) || !last) {
      continue;
    }
    const message = toVkCommunityInboxMessage(last, groupId, profiles);
    if (message) {
      messages.push(message);
    }
  }
  return messages;
}

export function parseVkCommunityHistory(
  payload: unknown,
  groupId: string,
  seedProfiles?: Map<number, { screen_name?: string }>,
): InboxMessage[] {
  const parsed = historySchema.safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("VK messages.getHistory returned an unexpected payload");
  }

  const profiles = profilesFromVk(parsed.data.profiles, seedProfiles);
  const messages: InboxMessage[] = [];
  for (const item of parsed.data.items ?? []) {
    if (item.peer_id !== undefined && !isVkUserPeer({ id: item.peer_id })) {
      continue;
    }
    const message = toVkCommunityInboxMessage(item, groupId, profiles);
    if (message) {
      messages.push(message);
    }
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
  const inboundMessages = cursor.history
    ? directMessages.filter((message) => isDigitIdAfter(message.externalId, cursor.messages))
    : directMessages;
  return {
    messages: [...filterMessagesAfterCursor(comments, cursor.comments), ...inboundMessages],
    cursor: serializeNamedInboxCursor({
      comments: laterDigitId(cursor.comments, newestVkCommentUnix(comments)) ?? "",
      history: "1",
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
  const parsed = conversationsSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("VK messages.getConversations returned an unexpected payload");
  }

  const seedProfiles = profilesFromVk(parsed.data.profiles);
  const peerIds: number[] = [];
  const seenPeers = new Set<number>();
  for (const item of parsed.data.items ?? []) {
    const peer = item.conversation?.peer;
    if (!peer || !isVkUserPeer(peer) || seenPeers.has(peer.id)) {
      continue;
    }
    seenPeers.add(peer.id);
    peerIds.push(peer.id);
  }

  const messages: InboxMessage[] = [];
  const seenIds = new Set<string>();
  for (const peerId of peerIds) {
    const historyPayload = await vkCall("messages.getHistory", {
      access_token: accessToken,
      peer_id: String(peerId),
      count: VK_COMMUNITY_HISTORY_COUNT,
      extended: "1",
      group_id: groupId,
    });
    for (const message of parseVkCommunityHistory(historyPayload, groupId, seedProfiles)) {
      if (seenIds.has(message.externalId)) {
        continue;
      }
      seenIds.add(message.externalId);
      messages.push(message);
    }
  }
  return messages;
}

function isVkUserPeer(peer: { id: number; type?: string }): boolean {
  if (peer.type === "chat" || peer.type === "group") {
    return false;
  }
  return peer.id > 0 && peer.id < VK_CHAT_PEER_FLOOR;
}

function profilesFromVk(
  rows?: Array<{ id: number; screen_name?: string }>,
  seed?: Map<number, { screen_name?: string }>,
): Map<number, { screen_name?: string }> {
  const profiles = new Map(seed ?? []);
  for (const profile of rows ?? []) {
    profiles.set(profile.id, profile);
  }
  return profiles;
}

function toVkCommunityInboxMessage(
  item: z.infer<typeof vkMessageItemSchema>,
  groupId: string,
  profiles: Map<number, { screen_name?: string }>,
): InboxMessage | null {
  const communityFromId = -Number(groupId);
  const text = item.text?.trim();
  if (!text || item.out === 1 || item.from_id === undefined || item.from_id === communityFromId || item.from_id < 0) {
    return null;
  }
  const profile = profiles.get(item.from_id);
  return {
    externalId: String(item.id),
    externalProfileId: String(item.from_id),
    username: profile?.screen_name ? `@${profile.screen_name}` : null,
    body: text,
    url: null,
    receivedAt: item.date ? new Date(item.date * 1000).toISOString() : null,
    replyKind: "direct_message",
  };
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
