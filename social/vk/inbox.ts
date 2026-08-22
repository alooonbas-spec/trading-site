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
import {
  decodeVkThreadMap,
  nextVkThreadCursor,
  parseVkThreadId,
  VK_THREAD_FETCH_LIMIT,
  type VkThreadMap,
} from "@/social/vk/thread-paging";

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

const vkCommentReplySchema = z.object({
  id: z.number(),
  from_id: z.number().optional(),
  text: z.string().optional(),
  date: z.number().optional(),
});

const wallCommentsSchema = z.object({
  items: z
    .array(
      vkCommentReplySchema.extend({
        thread: z
          .object({
            count: z.number().optional(),
            items: z.array(vkCommentReplySchema).optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

const mentionsSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.number(),
        owner_id: z.number().optional(),
        from_id: z.number().optional(),
        date: z.number().optional(),
        text: z.string().optional(),
      }),
    )
    .optional(),
});

const userPhotosSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.number(),
        owner_id: z.number().optional(),
        date: z.number().optional(),
        text: z.string().optional(),
      }),
    )
    .optional(),
});

const userPhotoCommentsSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.number(),
        from_id: z.number().optional(),
        date: z.number().optional(),
        text: z.string().optional(),
      }),
    )
    .optional(),
});

const photoCommentsSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.number(),
        pid: z.number().optional(),
        from_id: z.number().optional(),
        date: z.number().optional(),
        text: z.string().optional(),
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
const VK_WALL_THREAD_COUNT = "10";
const VK_MENTIONS_COUNT = "20";
const VK_USER_PHOTOS_COUNT = "20";
const VK_USER_PHOTO_COMMENT_COUNT = "50";
const VK_PHOTO_COMMENT_COUNT = "50";
const VK_VIDEO_COUNT = "10";
const VK_VIDEO_COMMENT_COUNT = "50";
const VK_VIDEO_THREAD_COUNT = "10";
const VK_CHAT_PEER_FLOOR = 2_000_000_000;

type VkOffsetPage = number | "done";
type VkWallPost = {
  id: number;
  owner_id?: number;
};

type VkVideo = {
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
  wallcomments: boolean;
  wallcommentsPage: VkOffsetPage;
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
    const wallcomments = vkOffsetCursor(named.wallcomments);
    return {
      comments: named.comments ?? null,
      messages: named.messages ?? null,
      history: history.started,
      historyPage: history.page,
      conversations: conversations.started,
      conversationsPage: conversations.page,
      wall: wall.started,
      wallPage: wall.page,
      wallcomments: wallcomments.started,
      wallcommentsPage: wallcomments.page,
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
  wallcomments: boolean;
  wallcommentsPage: VkOffsetPage;
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
    wallcomments: false,
    wallcommentsPage: 0,
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
  const named = parseNamedInboxCursor(input.cursor);
  const conversationOffset =
    cursor.conversationsPage !== 0 && cursor.conversationsPage !== "done"
      ? cursor.conversationsPage * Number(VK_COMMUNITY_CONVERSATION_COUNT)
      : null;
  const [wallComments, latestPeers, olderPeers] = await Promise.all([
    collectVkWallComments(accessToken, metadata, cursor.wallPage, cursor.wallcommentsPage, named.wallthreads),
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
      wallcomments: nextVkOffsetCursor(cursor.wallcommentsPage, wallComments.commentsReachedEnd),
      wallthreads: wallComments.wallthreads,
    }),
  };
}

async function collectVkWallCommentInbox(
  accessToken: string,
  metadata: Record<string, unknown> | undefined,
  cursor?: string | null,
): Promise<InboxResult> {
  const parsed = parseVkInboxCursor(cursor);
  const named = parseNamedInboxCursor(cursor);
  const mentionPage = vkOffsetCursor(named.mentionpages);
  const mentionOffset =
    mentionPage.page !== 0 && mentionPage.page !== "done"
      ? mentionPage.page * Number(VK_MENTIONS_COUNT)
      : null;
  const photoPage = vkOffsetCursor(named.photocomments);
  const photoOffset =
    photoPage.page !== 0 && photoPage.page !== "done"
      ? photoPage.page * Number(VK_PHOTO_COMMENT_COUNT)
      : null;
  const userPhotoPage = vkOffsetCursor(named.userphotos);
  const userPhotoCommentsPage = vkOffsetCursor(named.userphotocomments);
  const videoPage = vkOffsetCursor(named.videos);
  const videocommentsPage = vkOffsetCursor(named.videocomments);
  const [
    wallComments,
    latestMentions,
    olderMentions,
    latestPhotos,
    olderPhotos,
    userPhotos,
    videoComments,
  ] = await Promise.all([
      collectVkWallComments(accessToken, metadata, parsed.wallPage, parsed.wallcommentsPage, named.wallthreads),
      collectVkMentions(accessToken, 0),
      mentionOffset === null
        ? Promise.resolve(emptyVkMentionPage(true))
        : collectVkMentions(accessToken, mentionOffset),
      collectVkPhotoComments(accessToken, 0),
      photoOffset === null
        ? Promise.resolve(emptyVkMentionPage(true))
        : collectVkPhotoComments(accessToken, photoOffset),
      collectVkUserPhotoInbox(accessToken, userPhotoPage.page, userPhotoCommentsPage.page),
      collectVkVideoComments(accessToken, videoPage.page, videocommentsPage.page, named.videothreads),
    ]);
  return {
    messages: [
      ...filterMessagesAfterCursor(wallComments.latest, parsed.comments),
      ...wallComments.older,
      ...filterMessagesAfterCursor(latestMentions.messages, named.mentions ?? null),
      ...olderMentions.messages,
      ...filterMessagesAfterCursor(userPhotos.latestMentions, named.phototags ?? null),
      ...userPhotos.olderMentions,
      ...filterMessagesAfterCursor(userPhotos.latestComments, named.userphoto ?? null),
      ...userPhotos.olderComments,
      ...filterMessagesAfterCursor(latestPhotos.messages, named.photos ?? null),
      ...olderPhotos.messages,
      ...filterMessagesAfterCursor(videoComments.latest, named.video ?? null),
      ...videoComments.older,
    ],
    cursor: serializeNamedInboxCursor({
      comments: laterDigitId(parsed.comments, newestVkCommentUnix([...wallComments.latest, ...wallComments.older])) ?? "",
      mentionpages: nextVkOffsetCursor(mentionPage.page, olderMentions.reachedEnd),
      mentions:
        laterDigitId(
          named.mentions,
          newestVkCommentUnix([...latestMentions.messages, ...olderMentions.messages]),
        ) ?? "",
      photocomments: nextVkOffsetCursor(photoPage.page, olderPhotos.reachedEnd),
      photos:
        laterDigitId(named.photos, newestVkCommentUnix([...latestPhotos.messages, ...olderPhotos.messages])) ??
        "",
      phototags:
        laterDigitId(
          named.phototags,
          newestVkCommentUnix([...userPhotos.latestMentions, ...userPhotos.olderMentions]),
        ) ?? "",
      userphoto:
        laterDigitId(
          named.userphoto,
          newestVkCommentUnix([...userPhotos.latestComments, ...userPhotos.olderComments]),
        ) ?? "",
      userphotocomments: nextVkOffsetCursor(userPhotoCommentsPage.page, userPhotos.commentsReachedEnd),
      userphotos: nextVkOffsetCursor(userPhotoPage.page, userPhotos.reachedEnd),
      video:
        laterDigitId(named.video, newestVkCommentUnix([...videoComments.latest, ...videoComments.older])) ?? "",
      videocomments: nextVkOffsetCursor(videocommentsPage.page, videoComments.commentsReachedEnd),
      videos: nextVkOffsetCursor(videoPage.page, videoComments.reachedEnd),
      videothreads: videoComments.videothreads,
      wall: nextVkOffsetCursor(parsed.wallPage, wallComments.reachedEnd),
      wallcomments: nextVkOffsetCursor(parsed.wallcommentsPage, wallComments.commentsReachedEnd),
      wallthreads: wallComments.wallthreads,
    }),
  };
}

async function collectVkMentions(
  accessToken: string,
  offset: number,
): Promise<{ messages: InboxMessage[]; reachedEnd: boolean }> {
  const pageSize = Number(VK_MENTIONS_COUNT);
  const params: Record<string, string> = {
    access_token: accessToken,
    count: VK_MENTIONS_COUNT,
  };
  if (offset > 0) {
    params.offset = String(offset);
  }
  const payload = await vkCall("newsfeed.getMentions", params);
  const parsed = mentionsSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("VK newsfeed.getMentions returned an unexpected payload");
  }
  const messages: InboxMessage[] = [];
  for (const post of parsed.data.items ?? []) {
    const text = post.text?.trim();
    const ownerId = post.owner_id;
    const fromId = post.from_id;
    if (!text || ownerId === undefined || fromId === undefined) {
      continue;
    }
    messages.push({
      externalId: `${ownerId}:${post.id}`,
      externalProfileId: String(fromId),
      username: null,
      body: text,
      url: `https://vk.com/wall${ownerId}_${post.id}`,
      receivedAt: post.date ? new Date(post.date * 1000).toISOString() : null,
      replyKind: "mention",
    });
  }
  return {
    messages,
    reachedEnd: (parsed.data.items ?? []).length < pageSize,
  };
}

function emptyVkMentionPage(reachedEnd: boolean): { messages: InboxMessage[]; reachedEnd: boolean } {
  return { messages: [], reachedEnd };
}

type VkUserPhoto = {
  id: number;
  owner_id?: number;
  date?: number;
  text?: string;
};

async function collectVkUserPhotoInbox(
  accessToken: string,
  userPhotoPage: VkOffsetPage,
  commentsPage: VkOffsetPage,
): Promise<{
  latestMentions: InboxMessage[];
  olderMentions: InboxMessage[];
  latestComments: InboxMessage[];
  olderComments: InboxMessage[];
  reachedEnd: boolean;
  commentsReachedEnd: boolean;
}> {
  const photoOffset =
    userPhotoPage !== 0 && userPhotoPage !== "done" ? userPhotoPage * Number(VK_USER_PHOTOS_COUNT) : null;
  const commentOffset =
    commentsPage !== 0 && commentsPage !== "done"
      ? commentsPage * Number(VK_USER_PHOTO_COMMENT_COUNT)
      : null;
  const [latestPhotos, olderPhotos] = await Promise.all([
    listVkUserPhotos(accessToken, 0),
    photoOffset === null
      ? Promise.resolve(emptyVkUserPhotos(true))
      : listVkUserPhotos(accessToken, photoOffset),
  ]);
  const commentPhotos = [...latestPhotos.photos, ...olderPhotos.photos];
  const [latestComments, olderPhotoComments, extraComments] = await Promise.all([
    collectVkCommentsForUserPhotos(accessToken, latestPhotos.photos, 0),
    collectVkCommentsForUserPhotos(accessToken, olderPhotos.photos, 0),
    commentOffset === null
      ? Promise.resolve(emptyVkUserPhotoCommentPage(true))
      : collectVkCommentsForUserPhotos(accessToken, commentPhotos, commentOffset),
  ]);
  return {
    latestMentions: vkUserPhotosToMentions(latestPhotos.photos),
    olderMentions: vkUserPhotosToMentions(olderPhotos.photos),
    latestComments: latestComments.messages,
    olderComments: uniqueInboxMessages([...olderPhotoComments.messages, ...extraComments.messages]),
    reachedEnd: olderPhotos.reachedEnd,
    commentsReachedEnd: extraComments.reachedEnd,
  };
}

function emptyVkUserPhotos(reachedEnd: boolean): { photos: VkUserPhoto[]; reachedEnd: boolean } {
  return { photos: [], reachedEnd };
}

function emptyVkUserPhotoCommentPage(reachedEnd: boolean): { messages: InboxMessage[]; reachedEnd: boolean } {
  return { messages: [], reachedEnd };
}

async function listVkUserPhotos(
  accessToken: string,
  offset: number,
): Promise<{ photos: VkUserPhoto[]; reachedEnd: boolean }> {
  const pageSize = Number(VK_USER_PHOTOS_COUNT);
  const params: Record<string, string> = {
    access_token: accessToken,
    count: VK_USER_PHOTOS_COUNT,
  };
  if (offset > 0) {
    params.offset = String(offset);
  }
  const payload = await vkCall("photos.getUserPhotos", params);
  const parsed = userPhotosSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("VK photos.getUserPhotos returned an unexpected payload");
  }
  const photos = parsed.data.items ?? [];
  return { photos, reachedEnd: photos.length < pageSize };
}

function vkUserPhotosToMentions(photos: VkUserPhoto[]): InboxMessage[] {
  const messages: InboxMessage[] = [];
  for (const photo of photos) {
    const text = photo.text?.trim();
    const ownerId = photo.owner_id;
    if (!text || ownerId === undefined) {
      continue;
    }
    messages.push({
      externalId: `phototag:${ownerId}:${photo.id}`,
      externalProfileId: String(ownerId),
      username: null,
      body: text,
      url: `https://vk.com/photo${ownerId}_${photo.id}`,
      receivedAt: photo.date ? new Date(photo.date * 1000).toISOString() : null,
      replyKind: "mention",
    });
  }
  return messages;
}

async function collectVkCommentsForUserPhotos(
  accessToken: string,
  photos: VkUserPhoto[],
  offset: number,
): Promise<{ messages: InboxMessage[]; reachedEnd: boolean }> {
  const pageSize = Number(VK_USER_PHOTO_COMMENT_COUNT);
  const messages: InboxMessage[] = [];
  let reachedEnd = true;
  for (const photo of photos) {
    const ownerId = photo.owner_id;
    if (ownerId === undefined) {
      continue;
    }
    const params: Record<string, string> = {
      access_token: accessToken,
      owner_id: String(ownerId),
      photo_id: String(photo.id),
      count: VK_USER_PHOTO_COMMENT_COUNT,
      sort: "desc",
    };
    if (offset > 0) {
      params.offset = String(offset);
    }
    const payload = await vkCall("photos.getComments", params);
    const parsed = userPhotoCommentsSchema.safeParse(payload);
    if (!parsed.success) {
      throw new SocialError("VK photos.getComments returned an unexpected payload");
    }
    if ((parsed.data.items ?? []).length >= pageSize) {
      reachedEnd = false;
    }
    for (const comment of parsed.data.items ?? []) {
      const text = comment.text?.trim();
      if (!text || comment.from_id === undefined) {
        continue;
      }
      messages.push({
        externalId: `phototag:${ownerId}:${photo.id}:${comment.id}`,
        externalProfileId: String(comment.from_id),
        username: null,
        body: text,
        url: `https://vk.com/photo${ownerId}_${photo.id}?reply=${comment.id}`,
        receivedAt: comment.date ? new Date(comment.date * 1000).toISOString() : null,
        replyKind: "comment",
      });
    }
  }
  return { messages, reachedEnd: photos.length === 0 ? true : reachedEnd };
}

async function collectVkPhotoComments(
  accessToken: string,
  offset: number,
): Promise<{ messages: InboxMessage[]; reachedEnd: boolean }> {
  const pageSize = Number(VK_PHOTO_COMMENT_COUNT);
  const params: Record<string, string> = {
    access_token: accessToken,
    count: VK_PHOTO_COMMENT_COUNT,
  };
  if (offset > 0) {
    params.offset = String(offset);
  }
  const payload = await vkCall("photos.getAllComments", params);
  const parsed = photoCommentsSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("VK photos.getAllComments returned an unexpected payload");
  }
  const messages: InboxMessage[] = [];
  for (const comment of parsed.data.items ?? []) {
    const text = comment.text?.trim();
    if (!text || comment.from_id === undefined || comment.pid === undefined) {
      continue;
    }
    messages.push({
      externalId: `photo:${comment.pid}:${comment.id}`,
      externalProfileId: String(comment.from_id),
      username: null,
      body: text,
      url: null,
      receivedAt: comment.date ? new Date(comment.date * 1000).toISOString() : null,
      replyKind: "comment",
    });
  }
  return {
    messages,
    reachedEnd: (parsed.data.items ?? []).length < pageSize,
  };
}

async function collectVkVideoComments(
  accessToken: string,
  videoPage: VkOffsetPage,
  videocommentsPage: VkOffsetPage,
  videothreadsStored?: string,
): Promise<{
  latest: InboxMessage[];
  older: InboxMessage[];
  reachedEnd: boolean;
  commentsReachedEnd: boolean;
  videothreads: string;
}> {
  const videoOffset =
    videoPage !== 0 && videoPage !== "done" ? videoPage * Number(VK_VIDEO_COUNT) : null;
  const commentOffset =
    videocommentsPage !== 0 && videocommentsPage !== "done"
      ? videocommentsPage * Number(VK_VIDEO_COMMENT_COUNT)
      : null;
  const [latestVideos, olderVideos] = await Promise.all([
    listVkVideos(accessToken, 0),
    videoOffset === null
      ? Promise.resolve(emptyVkVideos(true))
      : listVkVideos(accessToken, videoOffset),
  ]);
  const commentVideos = [...latestVideos.videos, ...olderVideos.videos];
  const [latest, olderVideo, olderComments] = await Promise.all([
    collectVkCommentsForVideos(accessToken, latestVideos.videos, 0),
    collectVkCommentsForVideos(accessToken, olderVideos.videos, 0),
    commentOffset === null
      ? Promise.resolve(emptyVkCommentPage(true))
      : collectVkCommentsForVideos(accessToken, commentVideos, commentOffset),
  ]);
  const storedThreads = decodeVkThreadMap(videothreadsStored);
  const extraThreads =
    storedThreads === null
      ? { messages: [] as InboxMessage[], nextAfters: {} as VkThreadMap, fetchedIds: [] as string[] }
      : await collectVkVideoThreads(accessToken, storedThreads);
  return {
    latest: latest.messages,
    older: uniqueInboxMessages([...olderVideo.messages, ...olderComments.messages, ...extraThreads.messages]),
    reachedEnd: olderVideos.reachedEnd,
    commentsReachedEnd: olderComments.reachedEnd,
    videothreads: nextVkThreadCursor({
      stored: videothreadsStored,
      nestedAfters: {
        ...latest.nestedAfters,
        ...olderVideo.nestedAfters,
        ...olderComments.nestedAfters,
      },
      fetchedNextAfters: extraThreads.nextAfters,
      fetchedIds: extraThreads.fetchedIds,
    }),
  };
}

function emptyVkVideos(reachedEnd: boolean): { videos: VkVideo[]; reachedEnd: boolean } {
  return { videos: [], reachedEnd };
}

async function listVkVideos(
  accessToken: string,
  offset: number,
): Promise<{ videos: VkVideo[]; reachedEnd: boolean }> {
  const pageSize = Number(VK_VIDEO_COUNT);
  const params: Record<string, string> = {
    access_token: accessToken,
    count: VK_VIDEO_COUNT,
  };
  if (offset > 0) {
    params.offset = String(offset);
  }
  const payload = await vkCall("video.get", params);
  const parsed = wallGetSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("VK video.get returned an unexpected payload");
  }
  const videos = parsed.data.items ?? [];
  return { videos, reachedEnd: videos.length < pageSize };
}

async function collectVkCommentsForVideos(
  accessToken: string,
  videos: VkVideo[],
  offset: number,
): Promise<{ messages: InboxMessage[]; reachedEnd: boolean; nestedAfters: VkThreadMap }> {
  const pageSize = Number(VK_VIDEO_COMMENT_COUNT);
  const messages: InboxMessage[] = [];
  const nestedAfters: VkThreadMap = {};
  let reachedEnd = true;
  for (const video of videos) {
    const ownerId = video.owner_id;
    if (ownerId === undefined) {
      continue;
    }
    const params: Record<string, string> = {
      access_token: accessToken,
      owner_id: String(ownerId),
      video_id: String(video.id),
      count: VK_VIDEO_COMMENT_COUNT,
      sort: "desc",
      thread_items_count: VK_VIDEO_THREAD_COUNT,
    };
    if (offset > 0) {
      params.offset = String(offset);
    }
    const commentsPayload = await vkCall("video.getComments", params);
    const comments = wallCommentsSchema.safeParse(commentsPayload);
    if (!comments.success) {
      throw new SocialError("VK video.getComments returned an unexpected payload");
    }
    if ((comments.data.items ?? []).length >= pageSize) {
      reachedEnd = false;
    }
    const parsed = vkVideoCommentsToInbox(comments.data.items ?? [], ownerId, video.id);
    messages.push(...parsed.messages);
    Object.assign(nestedAfters, parsed.nestedAfters);
  }
  return { messages, reachedEnd: videos.length === 0 ? true : reachedEnd, nestedAfters };
}

function vkVideoCommentsToInbox(
  comments: Array<{
    id: number;
    from_id?: number;
    text?: string;
    date?: number;
    thread?: { count?: number; items?: Array<{ id: number; from_id?: number; text?: string; date?: number }> };
  }>,
  ownerId: number,
  videoId: number,
): { messages: InboxMessage[]; nestedAfters: VkThreadMap } {
  const messages: InboxMessage[] = [];
  const nestedAfters: VkThreadMap = {};
  for (const comment of comments) {
    const message = vkVideoCommentMessage(comment, ownerId, videoId);
    if (message) {
      messages.push(message);
    }
    const threadItems = comment.thread?.items ?? [];
    for (const reply of threadItems) {
      const nested = vkVideoCommentMessage(reply, ownerId, videoId);
      if (nested) {
        messages.push(nested);
      }
    }
    if ((comment.thread?.count ?? 0) > threadItems.length) {
      nestedAfters[`${ownerId}_${videoId}_${comment.id}`] = "1";
    }
  }
  return { messages, nestedAfters };
}

function vkVideoCommentMessage(
  comment: { id: number; from_id?: number; text?: string; date?: number },
  ownerId: number,
  videoId: number,
): InboxMessage | null {
  const text = comment.text?.trim();
  if (!text || comment.from_id === undefined || comment.from_id === ownerId) {
    return null;
  }
  return {
    externalId: `video:${ownerId}:${videoId}:${comment.id}`,
    externalProfileId: String(comment.from_id),
    username: null,
    body: text,
    url: `https://vk.com/video${ownerId}_${videoId}?reply=${comment.id}`,
    receivedAt: comment.date ? new Date(comment.date * 1000).toISOString() : null,
    replyKind: "comment",
  };
}

async function collectVkVideoThreads(
  accessToken: string,
  stored: VkThreadMap,
): Promise<{ messages: InboxMessage[]; nextAfters: VkThreadMap; fetchedIds: string[] }> {
  const pageSize = Number(VK_VIDEO_THREAD_COUNT);
  const messages: InboxMessage[] = [];
  const nextAfters: VkThreadMap = {};
  const fetchedIds: string[] = [];
  for (const id of Object.keys(stored).slice(0, VK_THREAD_FETCH_LIMIT)) {
    const ref = parseVkThreadId(id);
    const page = Number(stored[id]);
    if (!ref || !Number.isInteger(page) || page < 1) {
      continue;
    }
    fetchedIds.push(id);
    const params: Record<string, string> = {
      access_token: accessToken,
      owner_id: ref.ownerId,
      video_id: ref.postId,
      comment_id: ref.commentId,
      count: VK_VIDEO_THREAD_COUNT,
      sort: "desc",
      offset: String(page * pageSize),
    };
    const commentsPayload = await vkCall("video.getComments", params);
    const comments = wallCommentsSchema.safeParse(commentsPayload);
    if (!comments.success) {
      throw new SocialError("VK video.getComments returned an unexpected payload");
    }
    const rawItems = comments.data.items ?? [];
    if (rawItems.length >= pageSize) {
      nextAfters[id] = String(page + 1);
    }
    for (const comment of rawItems) {
      if (comment.id === Number(ref.commentId)) {
        continue;
      }
      const message = vkVideoCommentMessage(comment, Number(ref.ownerId), Number(ref.postId));
      if (message) {
        messages.push(message);
      }
    }
  }
  return { messages, nextAfters, fetchedIds };
}

async function collectVkWallComments(
  accessToken: string,
  metadata: Record<string, unknown> | undefined,
  wallPage: VkOffsetPage,
  wallcommentsPage: VkOffsetPage,
  wallthreadsStored?: string,
): Promise<{
  latest: InboxMessage[];
  older: InboxMessage[];
  reachedEnd: boolean;
  commentsReachedEnd: boolean;
  wallthreads: string;
}> {
  const wallOffset =
    wallPage !== 0 && wallPage !== "done" ? wallPage * Number(VK_WALL_COUNT) : null;
  const commentOffset =
    wallcommentsPage !== 0 && wallcommentsPage !== "done"
      ? wallcommentsPage * Number(VK_WALL_COMMENT_COUNT)
      : null;
  const [latestPosts, olderPosts] = await Promise.all([
    listVkWallPosts(accessToken, metadata, 0),
    wallOffset === null
      ? Promise.resolve(emptyVkWallPosts(true))
      : listVkWallPosts(accessToken, metadata, wallOffset),
  ]);
  const commentPosts = [...latestPosts.posts, ...olderPosts.posts];
  const [latest, olderWall, olderComments] = await Promise.all([
    collectVkCommentsForPosts(accessToken, metadata, latestPosts.posts, 0),
    collectVkCommentsForPosts(accessToken, metadata, olderPosts.posts, 0),
    commentOffset === null
      ? Promise.resolve(emptyVkCommentPage(true))
      : collectVkCommentsForPosts(accessToken, metadata, commentPosts, commentOffset),
  ]);
  const storedThreads = decodeVkThreadMap(wallthreadsStored);
  const extraThreads =
    storedThreads === null
      ? { messages: [] as InboxMessage[], nextAfters: {} as VkThreadMap, fetchedIds: [] as string[] }
      : await collectVkWallThreads(accessToken, storedThreads);
  return {
    latest: latest.messages,
    older: uniqueInboxMessages([...olderWall.messages, ...olderComments.messages, ...extraThreads.messages]),
    reachedEnd: olderPosts.reachedEnd,
    commentsReachedEnd: olderComments.reachedEnd,
    wallthreads: nextVkThreadCursor({
      stored: wallthreadsStored,
      nestedAfters: {
        ...latest.nestedAfters,
        ...olderWall.nestedAfters,
        ...olderComments.nestedAfters,
      },
      fetchedNextAfters: extraThreads.nextAfters,
      fetchedIds: extraThreads.fetchedIds,
    }),
  };
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
  offset: number,
): Promise<{ messages: InboxMessage[]; reachedEnd: boolean; nestedAfters: VkThreadMap }> {
  const target = vkWallTarget(metadata);
  const pageSize = Number(VK_WALL_COMMENT_COUNT);
  const messages: InboxMessage[] = [];
  const nestedAfters: VkThreadMap = {};
  let reachedEnd = true;
  for (const post of posts) {
    const params: Record<string, string> = {
      access_token: accessToken,
      post_id: String(post.id),
      count: VK_WALL_COMMENT_COUNT,
      sort: "desc",
      thread_items_count: VK_WALL_THREAD_COUNT,
    };
    if (target.ownerId) {
      params.owner_id = target.ownerId;
    }
    if (offset > 0) {
      params.offset = String(offset);
    }
    const commentsPayload = await vkCall("wall.getComments", params);
    const comments = wallCommentsSchema.safeParse(commentsPayload);
    if (!comments.success) {
      throw new SocialError("VK wall.getComments returned an unexpected payload");
    }
    if ((comments.data.items ?? []).length >= pageSize) {
      reachedEnd = false;
    }
    const ownerId = post.owner_id ?? (target.ownerId ? Number(target.ownerId) : null);
    const parsed = vkCommentsToInbox(comments.data.items ?? [], ownerId, post.id);
    messages.push(...parsed.messages);
    Object.assign(nestedAfters, parsed.nestedAfters);
  }
  return { messages, reachedEnd: posts.length === 0 ? true : reachedEnd, nestedAfters };
}

function emptyVkCommentPage(reachedEnd: boolean): {
  messages: InboxMessage[];
  reachedEnd: boolean;
  nestedAfters: VkThreadMap;
} {
  return { messages: [], reachedEnd, nestedAfters: {} };
}

function vkCommentsToInbox(
  comments: Array<{
    id: number;
    from_id?: number;
    text?: string;
    date?: number;
    thread?: { count?: number; items?: Array<{ id: number; from_id?: number; text?: string; date?: number }> };
  }>,
  ownerId: number | null,
  postId: number,
): { messages: InboxMessage[]; nestedAfters: VkThreadMap } {
  const messages: InboxMessage[] = [];
  const nestedAfters: VkThreadMap = {};
  for (const comment of comments) {
    const message = vkWallCommentMessage(comment, ownerId, postId);
    if (message) {
      messages.push(message);
    }
    const threadItems = comment.thread?.items ?? [];
    for (const reply of threadItems) {
      const nested = vkWallCommentMessage(reply, ownerId, postId);
      if (nested) {
        messages.push(nested);
      }
    }
    if (ownerId !== null && (comment.thread?.count ?? 0) > threadItems.length) {
      nestedAfters[`${ownerId}_${postId}_${comment.id}`] = "1";
    }
  }
  return { messages, nestedAfters };
}

function vkWallCommentMessage(
  comment: { id: number; from_id?: number; text?: string; date?: number },
  ownerId: number | null,
  postId: number,
): InboxMessage | null {
  const text = comment.text?.trim();
  if (!text || comment.from_id === undefined || comment.from_id === ownerId) {
    return null;
  }
  return {
    externalId: `${ownerId ?? ""}:${postId}:${comment.id}`,
    externalProfileId: String(comment.from_id),
    username: null,
    body: text,
    url: ownerId ? `https://vk.com/wall${ownerId}_${postId}?reply=${comment.id}` : null,
    receivedAt: comment.date ? new Date(comment.date * 1000).toISOString() : null,
    replyKind: "comment",
  };
}

async function collectVkWallThreads(
  accessToken: string,
  stored: VkThreadMap,
): Promise<{ messages: InboxMessage[]; nextAfters: VkThreadMap; fetchedIds: string[] }> {
  const pageSize = Number(VK_WALL_THREAD_COUNT);
  const messages: InboxMessage[] = [];
  const nextAfters: VkThreadMap = {};
  const fetchedIds: string[] = [];
  for (const id of Object.keys(stored).slice(0, VK_THREAD_FETCH_LIMIT)) {
    const ref = parseVkThreadId(id);
    const page = Number(stored[id]);
    if (!ref || !Number.isInteger(page) || page < 1) {
      continue;
    }
    fetchedIds.push(id);
    const params: Record<string, string> = {
      access_token: accessToken,
      owner_id: ref.ownerId,
      post_id: ref.postId,
      comment_id: ref.commentId,
      count: VK_WALL_THREAD_COUNT,
      sort: "desc",
      offset: String(page * pageSize),
    };
    const commentsPayload = await vkCall("wall.getComments", params);
    const comments = wallCommentsSchema.safeParse(commentsPayload);
    if (!comments.success) {
      throw new SocialError("VK wall.getComments returned an unexpected payload");
    }
    const rawItems = comments.data.items ?? [];
    if (rawItems.length >= pageSize) {
      nextAfters[id] = String(page + 1);
    }
    for (const comment of rawItems) {
      if (comment.id === Number(ref.commentId)) {
        continue;
      }
      const message = vkWallCommentMessage(comment, Number(ref.ownerId), Number(ref.postId));
      if (message) {
        messages.push(message);
      }
    }
  }
  return { messages, nextAfters, fetchedIds };
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

export function parseVkInboxMentionRef(externalId: string): {
  ownerId: string;
  postId: string;
} {
  const parts = externalId.split(":");
  const ownerId = parts[0];
  const postId = parts[1];
  if (parts.length !== 2 || !ownerId || !postId || !/^-?\d+$/.test(ownerId) || !/^\d+$/.test(postId)) {
    throw new ValidationError("VK mention replies require owner and post ids from newsfeed.getMentions");
  }
  return { ownerId, postId };
}

export function parseVkInboxPhotoTagRef(externalId: string): {
  ownerId: string;
  photoId: string;
} {
  const parts = externalId.split(":");
  const ownerId = parts[1];
  const photoId = parts[2];
  if (
    parts[0] !== "phototag" ||
    parts.length !== 3 ||
    !ownerId ||
    !photoId ||
    !/^-?\d+$/.test(ownerId) ||
    !/^\d+$/.test(photoId)
  ) {
    throw new ValidationError("VK photo tag replies require owner and photo ids from photos.getUserPhotos");
  }
  return { ownerId, photoId };
}

export function parseVkInboxPhotoTagCommentRef(externalId: string): {
  ownerId: string;
  photoId: string;
  commentId: string;
} {
  const parts = externalId.split(":");
  const ownerId = parts[1];
  const photoId = parts[2];
  const commentId = parts[3];
  if (
    parts[0] !== "phototag" ||
    parts.length !== 4 ||
    !ownerId ||
    !photoId ||
    !commentId ||
    !/^-?\d+$/.test(ownerId) ||
    !/^\d+$/.test(photoId) ||
    !/^\d+$/.test(commentId)
  ) {
    throw new ValidationError(
      "VK tagged photo comment replies require owner, photo, and comment ids from photos.getComments",
    );
  }
  return { ownerId, photoId, commentId };
}

export function parseVkInboxPhotoCommentRef(externalId: string): {
  photoId: string;
  commentId: string;
} {
  const parts = externalId.split(":");
  const photoId = parts[1];
  const commentId = parts[2];
  if (
    parts[0] !== "photo" ||
    parts.length !== 3 ||
    !photoId ||
    !commentId ||
    !/^\d+$/.test(photoId) ||
    !/^\d+$/.test(commentId)
  ) {
    throw new ValidationError("VK photo comment replies require photo and comment ids from photos.getAllComments");
  }
  return { photoId, commentId };
}

export function parseVkInboxVideoCommentRef(externalId: string): {
  ownerId: string;
  videoId: string;
  commentId: string;
} {
  const parts = externalId.split(":");
  const ownerId = parts[1];
  const videoId = parts[2];
  const commentId = parts[3];
  if (
    parts[0] !== "video" ||
    parts.length !== 4 ||
    !ownerId ||
    !videoId ||
    !commentId ||
    !/^-?\d+$/.test(ownerId) ||
    !/^\d+$/.test(videoId) ||
    !/^\d+$/.test(commentId)
  ) {
    throw new ValidationError("VK video comment replies require owner, video, and comment ids from video.getComments");
  }
  return { ownerId, videoId, commentId };
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
  return postVkWallComment(accessToken, {
    owner_id: ref.ownerId,
    post_id: ref.postId,
    reply_to_comment: ref.commentId,
    message: text,
  });
}

export async function replyToVkWallMention(
  accessToken: string,
  input: { externalId: string; text: string },
): Promise<{ externalMessageId: string }> {
  const text = input.text.trim();
  if (!text) {
    throw new ValidationError("VK mention replies require a body");
  }

  const ref = parseVkInboxMentionRef(input.externalId);
  return postVkWallComment(accessToken, {
    owner_id: ref.ownerId,
    post_id: ref.postId,
    message: text,
  });
}

async function postVkWallComment(
  accessToken: string,
  params: Record<string, string>,
): Promise<{ externalMessageId: string }> {
  const payload = await vkCall("wall.createComment", {
    access_token: accessToken,
    ...params,
  });
  const parsed = createCommentSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("VK wall.createComment returned an unexpected payload");
  }
  return { externalMessageId: String(parsed.data.comment_id) };
}

export async function replyToVkPhotoTag(
  accessToken: string,
  input: { externalId: string; text: string },
): Promise<{ externalMessageId: string }> {
  const text = input.text.trim();
  if (!text) {
    throw new ValidationError("VK photo tag replies require a body");
  }

  const ref = parseVkInboxPhotoTagRef(input.externalId);
  const payload = await vkCall("photos.createComment", {
    access_token: accessToken,
    owner_id: ref.ownerId,
    photo_id: ref.photoId,
    message: text,
  });
  const parsed = z.number().safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("VK photos.createComment returned an unexpected payload");
  }
  return { externalMessageId: String(parsed.data) };
}

export async function replyToVkUserPhotoComment(
  accessToken: string,
  input: { externalId: string; text: string },
): Promise<{ externalMessageId: string }> {
  const text = input.text.trim();
  if (!text) {
    throw new ValidationError("VK tagged photo comment replies require a body");
  }

  const ref = parseVkInboxPhotoTagCommentRef(input.externalId);
  const payload = await vkCall("photos.createComment", {
    access_token: accessToken,
    owner_id: ref.ownerId,
    photo_id: ref.photoId,
    reply_to_comment: ref.commentId,
    message: text,
  });
  const parsed = z.number().safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("VK photos.createComment returned an unexpected payload");
  }
  return { externalMessageId: String(parsed.data) };
}

export async function replyToVkPhotoComment(
  accessToken: string,
  input: { externalId: string; text: string },
): Promise<{ externalMessageId: string }> {
  const text = input.text.trim();
  if (!text) {
    throw new ValidationError("VK photo comment replies require a body");
  }

  const ref = parseVkInboxPhotoCommentRef(input.externalId);
  const payload = await vkCall("photos.createComment", {
    access_token: accessToken,
    photo_id: ref.photoId,
    reply_to_comment: ref.commentId,
    message: text,
  });
  const parsed = z.number().safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("VK photos.createComment returned an unexpected payload");
  }
  return { externalMessageId: String(parsed.data) };
}

export async function replyToVkVideoComment(
  accessToken: string,
  input: { externalId: string; text: string },
): Promise<{ externalMessageId: string }> {
  const text = input.text.trim();
  if (!text) {
    throw new ValidationError("VK video comment replies require a body");
  }

  const ref = parseVkInboxVideoCommentRef(input.externalId);
  const payload = await vkCall("video.createComment", {
    access_token: accessToken,
    owner_id: ref.ownerId,
    video_id: ref.videoId,
    reply_to_comment: ref.commentId,
    message: text,
  });
  const parsed = z.number().safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("VK video.createComment returned an unexpected payload");
  }
  return { externalMessageId: String(parsed.data) };
}
