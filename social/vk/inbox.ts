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
const VK_COMMUNITY_CONVERSATION_COUNT = "20";
const VK_WALL_COUNT = "10";
const VK_WALL_COMMENT_COUNT = "50";
const VK_CHAT_PEER_FLOOR = 2_000_000_000;

type VkOffsetPage = number | "done";
type VkWallPost = {
  id: number;
  owner_id?: number;
};

export function parseVkInboxCursor(cursor?: string | null): {
  comments: string | null;
  messages: string | null;
  history: boolean;
  historyPage: VkOffsetPage;
  conversations: boolean;
  conversationsPage: VkOffsetPage;
  wall: boolean;
  wallPage: VkOffsetPage;
} {
  const value = cursor?.trim();
  if (!value) {
    return emptyVkInboxCursor();
  }
  if (isNamedInboxCursor(value)) {
    const named = parseNamedInboxCursor(value);
    const history = vkOffsetCursor(named.history);
    const conversations = vkOffsetCursor(named.conversations);
    const wall = vkOffsetCursor(named.wall);
    return {
      comments: named.comments ?? null,
      messages: named.messages ?? null,
      history: history.started,
      historyPage: history.page,
      conversations: conversations.started,
      conversationsPage: conversations.page,
      wall: wall.started,
      wallPage: wall.page,
    };
  }
  if (/^\d{10}$/.test(value)) {
    return { ...emptyVkInboxCursor(), comments: value };
  }
  return emptyVkInboxCursor();
}

function emptyVkInboxCursor(): {
  comments: string | null;
  messages: string | null;
  history: boolean;
  historyPage: VkOffsetPage;
  conversations: boolean;
  conversationsPage: VkOffsetPage;
  wall: boolean;
  wallPage: VkOffsetPage;
} {
  return {
    comments: null,
    messages: null,
    history: false,
    historyPage: 0,
    conversations: false,
    conversationsPage: 0,
    wall: false,
    wallPage: 0,
  };
}

function vkOffsetCursor(value: string | undefined): {
  started: boolean;
  page: VkOffsetPage;
} {
  if (value === "done") {
    return { started: true, page: "done" };
  }
  if (value && /^\d+$/.test(value) && value !== "0") {
    return { started: true, page: Number(value) };
  }
  return { started: false, page: 0 };
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
  const conversationOffset =
    cursor.conversationsPage !== 0 && cursor.conversationsPage !== "done"
      ? cursor.conversationsPage * Number(VK_COMMUNITY_CONVERSATION_COUNT)
      : null;
  const [wallComments, latestPeers, olderPeers] = await Promise.all([
    collectVkWallComments(accessToken, metadata, cursor.wallPage),
    listVkCommunityUserPeers(accessToken, groupId, 0),
    conversationOffset === null
      ? Promise.resolve(emptyVkCommunityPeers(true))
      : listVkCommunityUserPeers(accessToken, groupId, conversationOffset),
  ]);
  const peers = mergeVkCommunityPeers(latestPeers, olderPeers);
  const latestPage = await collectVkCommunityHistoryForPeers(accessToken, groupId, peers, 0);
  const newestMessageId = latestPage.messages.reduce<string | null>(
    (newest, message) => laterDigitId(newest, message.externalId),
    null,
  );
  const latestPeerIds = new Set(latestPeers.peerIds);
  const inboundLatest = latestPage.messages.filter((message) => {
    const peerId = Number(message.externalProfileId);
    if (cursor.history && latestPeerIds.has(peerId)) {
      return isDigitIdAfter(message.externalId, cursor.messages);
    }
    return true;
  });
  let olderMessages: InboxMessage[] = [];
  let reachedEnd = true;
  if (cursor.historyPage !== 0 && cursor.historyPage !== "done") {
    const olderPage = await collectVkCommunityHistoryForPeers(
      accessToken,
      groupId,
      peers,
      cursor.historyPage * Number(VK_COMMUNITY_HISTORY_COUNT),
    );
    olderMessages = olderPage.messages;
    reachedEnd = olderPage.reachedEnd;
  }
  return {
    messages: [
      ...filterMessagesAfterCursor(wallComments.latest, cursor.comments),
      ...wallComments.older,
      ...uniqueInboxMessages([...inboundLatest, ...olderMessages]),
    ],
    cursor: serializeNamedInboxCursor({
      comments: laterDigitId(cursor.comments, newestVkCommentUnix([...wallComments.latest, ...wallComments.older])) ?? "",
      conversations: nextVkOffsetCursor(cursor.conversationsPage, olderPeers.reachedEnd),
      history: nextVkOffsetCursor(cursor.historyPage, reachedEnd),
      messages: laterDigitId(cursor.messages, newestMessageId) ?? "",
      wall: nextVkOffsetCursor(cursor.wallPage, wallComments.reachedEnd),
    }),
  };
}

async function collectVkWallCommentInbox(
  accessToken: string,
  metadata: Record<string, unknown> | undefined,
  cursor?: string | null,
): Promise<InboxResult> {
  const parsed = parseVkInboxCursor(cursor);
  const wallComments = await collectVkWallComments(accessToken, metadata, parsed.wallPage);
  return {
    messages: [
      ...filterMessagesAfterCursor(wallComments.latest, parsed.comments),
      ...wallComments.older,
    ],
    cursor: serializeNamedInboxCursor({
      comments: laterDigitId(parsed.comments, newestVkCommentUnix([...wallComments.latest, ...wallComments.older])) ?? "",
      wall: nextVkOffsetCursor(parsed.wallPage, wallComments.reachedEnd),
    }),
  };
}

async function collectVkWallComments(
  accessToken: string,
  metadata: Record<string, unknown> | undefined,
  wallPage: VkOffsetPage,
): Promise<{ latest: InboxMessage[]; older: InboxMessage[]; reachedEnd: boolean }> {
  const wallOffset =
    wallPage !== 0 && wallPage !== "done" ? wallPage * Number(VK_WALL_COUNT) : null;
  const [latestPosts, olderPosts] = await Promise.all([
    listVkWallPosts(accessToken, metadata, 0),
    wallOffset === null
      ? Promise.resolve(emptyVkWallPosts(true))
      : listVkWallPosts(accessToken, metadata, wallOffset),
  ]);
  const [latest, older] = await Promise.all([
    collectVkCommentsForPosts(accessToken, metadata, latestPosts.posts),
    collectVkCommentsForPosts(accessToken, metadata, olderPosts.posts),
  ]);
  return { latest, older, reachedEnd: olderPosts.reachedEnd };
}

function emptyVkWallPosts(reachedEnd: boolean): { posts: VkWallPost[]; reachedEnd: boolean } {
  return { posts: [], reachedEnd };
}

async function listVkWallPosts(
  accessToken: string,
  metadata: Record<string, unknown> | undefined,
  offset: number,
): Promise<{ posts: VkWallPost[]; reachedEnd: boolean }> {
  const target = vkWallTarget(metadata);
  const pageSize = Number(VK_WALL_COUNT);
  const params: Record<string, string> = {
    access_token: accessToken,
    count: VK_WALL_COUNT,
    filter: "owner",
  };
  if (target.ownerId) {
    params.owner_id = target.ownerId;
  }
  if (offset > 0) {
    params.offset = String(offset);
  }
  const wallPayload = await vkCall("wall.get", params);
  const wall = wallGetSchema.safeParse(wallPayload);
  if (!wall.success) {
    throw new SocialError("VK wall.get returned an unexpected payload");
  }
  const posts = wall.data.items ?? [];
  return { posts, reachedEnd: posts.length < pageSize };
}

async function collectVkCommentsForPosts(
  accessToken: string,
  metadata: Record<string, unknown> | undefined,
  posts: VkWallPost[],
): Promise<InboxMessage[]> {
  const target = vkWallTarget(metadata);
  const messages: InboxMessage[] = [];
  for (const post of posts) {
    const commentsPayload = await vkCall("wall.getComments", {
      access_token: accessToken,
      post_id: String(post.id),
      count: VK_WALL_COMMENT_COUNT,
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

type VkCommunityPeers = {
  peerIds: number[];
  seedProfiles: Map<number, { screen_name?: string }>;
  reachedEnd: boolean;
};

async function listVkCommunityUserPeers(
  accessToken: string,
  groupId: string,
  offset: number,
): Promise<VkCommunityPeers> {
  const pageSize = Number(VK_COMMUNITY_CONVERSATION_COUNT);
  const params: Record<string, string> = {
    access_token: accessToken,
    count: VK_COMMUNITY_CONVERSATION_COUNT,
    filter: "all",
    extended: "1",
    group_id: groupId,
  };
  if (offset > 0) {
    params.offset = String(offset);
  }
  const payload = await vkCall("messages.getConversations", params);
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
  return {
    peerIds,
    seedProfiles,
    reachedEnd: (parsed.data.items ?? []).length < pageSize,
  };
}

function emptyVkCommunityPeers(reachedEnd: boolean): VkCommunityPeers {
  return { peerIds: [], seedProfiles: new Map(), reachedEnd };
}

function mergeVkCommunityPeers(latest: VkCommunityPeers, older: VkCommunityPeers): VkCommunityPeers {
  const seedProfiles = new Map(latest.seedProfiles);
  for (const [id, profile] of older.seedProfiles) {
    seedProfiles.set(id, profile);
  }
  const seen = new Set(latest.peerIds);
  const peerIds = [...latest.peerIds];
  for (const id of older.peerIds) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    peerIds.push(id);
  }
  return { peerIds, seedProfiles, reachedEnd: older.reachedEnd };
}

async function collectVkCommunityHistoryForPeers(
  accessToken: string,
  groupId: string,
  peers: { peerIds: number[]; seedProfiles: Map<number, { screen_name?: string }> },
  offset: number,
): Promise<{ messages: InboxMessage[]; reachedEnd: boolean }> {
  const pageSize = Number(VK_COMMUNITY_HISTORY_COUNT);
  const messages: InboxMessage[] = [];
  const seenIds = new Set<string>();
  let reachedEnd = true;
  for (const peerId of peers.peerIds) {
    const params: Record<string, string> = {
      access_token: accessToken,
      peer_id: String(peerId),
      count: VK_COMMUNITY_HISTORY_COUNT,
      extended: "1",
      group_id: groupId,
    };
    if (offset > 0) {
      params.offset = String(offset);
    }
    const historyPayload = await vkCall("messages.getHistory", params);
    const parsedHistory = historySchema.safeParse(historyPayload);
    if (!parsedHistory.success) {
      throw new SocialError("VK messages.getHistory returned an unexpected payload");
    }
    if ((parsedHistory.data.items ?? []).length >= pageSize) {
      reachedEnd = false;
    }
    for (const message of parseVkCommunityHistory(historyPayload, groupId, peers.seedProfiles)) {
      if (seenIds.has(message.externalId)) {
        continue;
      }
      seenIds.add(message.externalId);
      messages.push(message);
    }
  }
  return { messages, reachedEnd: peers.peerIds.length === 0 ? true : reachedEnd };
}

function nextVkOffsetCursor(current: VkOffsetPage, reachedEnd: boolean): string {
  if (current === "done") {
    return "done";
  }
  if (current === 0) {
    return "1";
  }
  if (reachedEnd) {
    return "done";
  }
  return String(current + 1);
}

function uniqueInboxMessages(messages: InboxMessage[]): InboxMessage[] {
  const seen = new Set<string>();
  const unique: InboxMessage[] = [];
  for (const message of messages) {
    if (seen.has(message.externalId)) {
      continue;
    }
    seen.add(message.externalId);
    unique.push(message);
  }
  return unique;
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
