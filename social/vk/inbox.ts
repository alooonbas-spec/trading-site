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
import { vkCall, vkCallIfAvailable } from "@/social/vk/api";
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

const wallRepostsSchema = z.object({
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

const userVideosSchema = userPhotosSchema;

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
const VK_WALL_REPOST_COUNT = "20";
const VK_MENTIONS_COUNT = "20";
const VK_USER_PHOTOS_COUNT = "20";
const VK_USER_PHOTO_COMMENT_COUNT = "50";
const VK_USER_VIDEOS_COUNT = "20";
const VK_USER_VIDEO_COMMENT_COUNT = "50";
const VK_PHOTO_COMMENT_COUNT = "50";
const VK_VIDEO_COUNT = "10";
const VK_VIDEO_COMMENT_COUNT = "50";
const VK_VIDEO_THREAD_COUNT = "10";
const VK_BOARD_TOPIC_COUNT = "10";
const VK_BOARD_COMMENT_COUNT = "50";
const VK_MARKET_ITEM_COUNT = "10";
const VK_MARKET_COMMENT_COUNT = "50";
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

type VkBoardTopic = {
  id: number;
};

type VkMarketItem = {
  id: number;
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
  const photoPage = vkOffsetCursor(named.photocomments);
  const photoOffset =
    photoPage.page !== 0 && photoPage.page !== "done"
      ? photoPage.page * Number(VK_PHOTO_COMMENT_COUNT)
      : null;
  const videoPage = vkOffsetCursor(named.videos);
  const videocommentsPage = vkOffsetCursor(named.videocomments);
  const boardTopicsPage = vkOffsetCursor(named.boardtopics);
  const boardCommentsPage = vkOffsetCursor(named.boardcomments);
  const marketItemsPage = vkOffsetCursor(named.marketitems);
  const marketCommentsPage = vkOffsetCursor(named.marketcomments);
  const repostPage = vkOffsetCursor(named.repostpages);
  const photoOwnerId = `-${groupId}`;
  const [
    wallComments,
    latestPeers,
    olderPeers,
    latestPhotos,
    olderPhotos,
    videoComments,
    boardComments,
    marketComments,
  ] = await Promise.all([
    collectVkWallComments(
      accessToken,
      metadata,
      cursor.wallPage,
      cursor.wallcommentsPage,
      named.wallthreads,
      repostPage.page,
    ),
    listVkCommunityUserPeers(accessToken, groupId, 0),
    conversationOffset === null
      ? Promise.resolve(emptyVkCommunityPeers(true))
      : listVkCommunityUserPeers(accessToken, groupId, conversationOffset),
    collectVkPhotoComments(accessToken, 0, photoOwnerId),
    photoOffset === null
      ? Promise.resolve(emptyVkPhotoCommentPage(true))
      : collectVkPhotoComments(accessToken, photoOffset, photoOwnerId),
    collectVkVideoComments(
      accessToken,
      videoPage.page,
      videocommentsPage.page,
      named.videothreads,
      photoOwnerId,
    ),
    collectVkBoardComments(accessToken, boardTopicsPage.page, boardCommentsPage.page, groupId),
    collectVkMarketComments(accessToken, marketItemsPage.page, marketCommentsPage.page, photoOwnerId),
  ]);
  const photosUnavailable = latestPhotos.unavailable || olderPhotos.unavailable;
  const videosUnavailable = videoComments.unavailable;
  const boardUnavailable = boardComments.unavailable;
  const marketUnavailable = marketComments.unavailable;
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
      ...filterMessagesAfterCursor(wallComments.latestReposts, named.reposts ?? null),
      ...wallComments.olderReposts,
      ...filterMessagesAfterCursor(latestPhotos.messages, named.photos ?? null),
      ...olderPhotos.messages,
      ...filterMessagesAfterCursor(videoComments.latest, named.video ?? null),
      ...videoComments.older,
      ...filterMessagesAfterCursor(boardComments.latest, named.board ?? null),
      ...boardComments.older,
      ...filterMessagesAfterCursor(marketComments.latest, named.market ?? null),
      ...marketComments.older,
      ...uniqueInboxMessages([...inboundLatest, ...olderMessages]),
    ],
    cursor: serializeNamedInboxCursor({
      board: boardUnavailable
        ? ""
        : laterDigitId(named.board, newestVkCommentUnix([...boardComments.latest, ...boardComments.older])) ?? "",
      boardcomments: boardUnavailable
        ? ""
        : nextVkOffsetCursor(boardCommentsPage.page, boardComments.commentsReachedEnd),
      boardtopics: boardUnavailable ? "" : nextVkOffsetCursor(boardTopicsPage.page, boardComments.reachedEnd),
      comments: laterDigitId(cursor.comments, newestVkCommentUnix([...wallComments.latest, ...wallComments.older])) ?? "",
      conversations: nextVkOffsetCursor(cursor.conversationsPage, olderPeers.reachedEnd),
      history: nextVkOffsetCursor(cursor.historyPage, reachedEnd),
      market: marketUnavailable
        ? ""
        : laterDigitId(named.market, newestVkCommentUnix([...marketComments.latest, ...marketComments.older])) ?? "",
      marketcomments: marketUnavailable
        ? ""
        : nextVkOffsetCursor(marketCommentsPage.page, marketComments.commentsReachedEnd),
      marketitems: marketUnavailable ? "" : nextVkOffsetCursor(marketItemsPage.page, marketComments.reachedEnd),
      messages: laterDigitId(cursor.messages, newestMessageId) ?? "",
      photocomments: photosUnavailable ? "" : nextVkOffsetCursor(photoPage.page, olderPhotos.reachedEnd),
      photos: photosUnavailable
        ? ""
        : laterDigitId(named.photos, newestVkCommentUnix([...latestPhotos.messages, ...olderPhotos.messages])) ??
          "",
      repostpages: nextVkOffsetCursor(repostPage.page, wallComments.repostsReachedEnd),
      reposts:
        laterDigitId(
          named.reposts,
          newestVkCommentUnix([...wallComments.latestReposts, ...wallComments.olderReposts]),
        ) ?? "",
      video: videosUnavailable
        ? ""
        : laterDigitId(named.video, newestVkCommentUnix([...videoComments.latest, ...videoComments.older])) ?? "",
      videocomments: videosUnavailable
        ? ""
        : nextVkOffsetCursor(videocommentsPage.page, videoComments.commentsReachedEnd),
      videos: videosUnavailable ? "" : nextVkOffsetCursor(videoPage.page, videoComments.reachedEnd),
      videothreads: videosUnavailable ? "" : videoComments.videothreads,
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
  const userVideoPage = vkOffsetCursor(named.uservideos);
  const userVideoCommentsPage = vkOffsetCursor(named.uservideocomments);
  const videoPage = vkOffsetCursor(named.videos);
  const videocommentsPage = vkOffsetCursor(named.videocomments);
  const repostPage = vkOffsetCursor(named.repostpages);
  const [
    wallComments,
    latestMentions,
    olderMentions,
    latestPhotos,
    olderPhotos,
    userPhotos,
    userVideos,
    videoComments,
  ] = await Promise.all([
      collectVkWallComments(
        accessToken,
        metadata,
        parsed.wallPage,
        parsed.wallcommentsPage,
        named.wallthreads,
        repostPage.page,
      ),
      collectVkMentions(accessToken, 0),
      mentionOffset === null
        ? Promise.resolve(emptyVkMentionPage(true))
        : collectVkMentions(accessToken, mentionOffset),
      collectVkPhotoComments(accessToken, 0),
      photoOffset === null
        ? Promise.resolve(emptyVkMentionPage(true))
        : collectVkPhotoComments(accessToken, photoOffset),
      collectVkUserPhotoInbox(accessToken, userPhotoPage.page, userPhotoCommentsPage.page),
      collectVkUserVideoInbox(accessToken, userVideoPage.page, userVideoCommentsPage.page),
      collectVkVideoComments(accessToken, videoPage.page, videocommentsPage.page, named.videothreads),
    ]);
  return {
    messages: [
      ...filterMessagesAfterCursor(wallComments.latest, parsed.comments),
      ...wallComments.older,
      ...filterMessagesAfterCursor(wallComments.latestReposts, named.reposts ?? null),
      ...wallComments.olderReposts,
      ...filterMessagesAfterCursor(latestMentions.messages, named.mentions ?? null),
      ...olderMentions.messages,
      ...filterMessagesAfterCursor(userPhotos.latestMentions, named.phototags ?? null),
      ...userPhotos.olderMentions,
      ...filterMessagesAfterCursor(userPhotos.latestComments, named.userphoto ?? null),
      ...userPhotos.olderComments,
      ...filterMessagesAfterCursor(userVideos.latestMentions, named.videotags ?? null),
      ...userVideos.olderMentions,
      ...filterMessagesAfterCursor(userVideos.latestComments, named.uservideo ?? null),
      ...userVideos.olderComments,
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
      repostpages: nextVkOffsetCursor(repostPage.page, wallComments.repostsReachedEnd),
      reposts:
        laterDigitId(
          named.reposts,
          newestVkCommentUnix([...wallComments.latestReposts, ...wallComments.olderReposts]),
        ) ?? "",
      userphoto:
        laterDigitId(
          named.userphoto,
          newestVkCommentUnix([...userPhotos.latestComments, ...userPhotos.olderComments]),
        ) ?? "",
      userphotocomments: nextVkOffsetCursor(userPhotoCommentsPage.page, userPhotos.commentsReachedEnd),
      userphotos: nextVkOffsetCursor(userPhotoPage.page, userPhotos.reachedEnd),
      uservideo:
        laterDigitId(
          named.uservideo,
          newestVkCommentUnix([...userVideos.latestComments, ...userVideos.olderComments]),
        ) ?? "",
      uservideocomments: nextVkOffsetCursor(userVideoCommentsPage.page, userVideos.commentsReachedEnd),
      uservideos: nextVkOffsetCursor(userVideoPage.page, userVideos.reachedEnd),
      video:
        laterDigitId(named.video, newestVkCommentUnix([...videoComments.latest, ...videoComments.older])) ?? "",
      videocomments: nextVkOffsetCursor(videocommentsPage.page, videoComments.commentsReachedEnd),
      videos: nextVkOffsetCursor(videoPage.page, videoComments.reachedEnd),
      videotags:
        laterDigitId(
          named.videotags,
          newestVkCommentUnix([...userVideos.latestMentions, ...userVideos.olderMentions]),
        ) ?? "",
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

function emptyVkPhotoCommentPage(reachedEnd: boolean): {
  messages: InboxMessage[];
  reachedEnd: boolean;
  unavailable: boolean;
} {
  return { messages: [], reachedEnd, unavailable: false };
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

type VkUserVideo = {
  id: number;
  owner_id?: number;
  date?: number;
  text?: string;
};

async function collectVkUserVideoInbox(
  accessToken: string,
  userVideoPage: VkOffsetPage,
  commentsPage: VkOffsetPage,
): Promise<{
  latestMentions: InboxMessage[];
  olderMentions: InboxMessage[];
  latestComments: InboxMessage[];
  olderComments: InboxMessage[];
  reachedEnd: boolean;
  commentsReachedEnd: boolean;
}> {
  const videoOffset =
    userVideoPage !== 0 && userVideoPage !== "done" ? userVideoPage * Number(VK_USER_VIDEOS_COUNT) : null;
  const commentOffset =
    commentsPage !== 0 && commentsPage !== "done"
      ? commentsPage * Number(VK_USER_VIDEO_COMMENT_COUNT)
      : null;
  const [latestVideos, olderVideos] = await Promise.all([
    listVkUserVideos(accessToken, 0),
    videoOffset === null
      ? Promise.resolve(emptyVkUserVideos(true))
      : listVkUserVideos(accessToken, videoOffset),
  ]);
  const commentVideos = [...latestVideos.videos, ...olderVideos.videos];
  const [latestComments, olderVideoComments, extraComments] = await Promise.all([
    collectVkCommentsForUserVideos(accessToken, latestVideos.videos, 0),
    collectVkCommentsForUserVideos(accessToken, olderVideos.videos, 0),
    commentOffset === null
      ? Promise.resolve(emptyVkUserVideoCommentPage(true))
      : collectVkCommentsForUserVideos(accessToken, commentVideos, commentOffset),
  ]);
  return {
    latestMentions: vkUserVideosToMentions(latestVideos.videos),
    olderMentions: vkUserVideosToMentions(olderVideos.videos),
    latestComments: latestComments.messages,
    olderComments: uniqueInboxMessages([...olderVideoComments.messages, ...extraComments.messages]),
    reachedEnd: olderVideos.reachedEnd,
    commentsReachedEnd: extraComments.reachedEnd,
  };
}

function emptyVkUserVideos(reachedEnd: boolean): { videos: VkUserVideo[]; reachedEnd: boolean } {
  return { videos: [], reachedEnd };
}

async function listVkUserVideos(
  accessToken: string,
  offset: number,
): Promise<{ videos: VkUserVideo[]; reachedEnd: boolean }> {
  const pageSize = Number(VK_USER_VIDEOS_COUNT);
  const params: Record<string, string> = {
    access_token: accessToken,
    count: VK_USER_VIDEOS_COUNT,
  };
  if (offset > 0) {
    params.offset = String(offset);
  }
  const payload = await vkCall("video.getUserVideos", params);
  const parsed = userVideosSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("VK video.getUserVideos returned an unexpected payload");
  }
  const videos = parsed.data.items ?? [];
  return { videos, reachedEnd: videos.length < pageSize };
}

function vkUserVideosToMentions(videos: VkUserVideo[]): InboxMessage[] {
  const messages: InboxMessage[] = [];
  for (const video of videos) {
    const text = video.text?.trim();
    const ownerId = video.owner_id;
    if (!text || ownerId === undefined) {
      continue;
    }
    messages.push({
      externalId: `videotag:${ownerId}:${video.id}`,
      externalProfileId: String(ownerId),
      username: null,
      body: text,
      url: `https://vk.com/video${ownerId}_${video.id}`,
      receivedAt: video.date ? new Date(video.date * 1000).toISOString() : null,
      replyKind: "mention",
    });
  }
  return messages;
}

function emptyVkUserVideoCommentPage(reachedEnd: boolean): { messages: InboxMessage[]; reachedEnd: boolean } {
  return { messages: [], reachedEnd };
}

async function collectVkCommentsForUserVideos(
  accessToken: string,
  videos: VkUserVideo[],
  offset: number,
): Promise<{ messages: InboxMessage[]; reachedEnd: boolean }> {
  const pageSize = Number(VK_USER_VIDEO_COMMENT_COUNT);
  const messages: InboxMessage[] = [];
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
      count: VK_USER_VIDEO_COMMENT_COUNT,
      sort: "desc",
    };
    if (offset > 0) {
      params.offset = String(offset);
    }
    const payload = await vkCall("video.getComments", params);
    const parsed = userPhotoCommentsSchema.safeParse(payload);
    if (!parsed.success) {
      throw new SocialError("VK video.getComments returned an unexpected payload");
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
        externalId: `videotag:${ownerId}:${video.id}:${comment.id}`,
        externalProfileId: String(comment.from_id),
        username: null,
        body: text,
        url: `https://vk.com/video${ownerId}_${video.id}?reply=${comment.id}`,
        receivedAt: comment.date ? new Date(comment.date * 1000).toISOString() : null,
        replyKind: "comment",
      });
    }
  }
  return { messages, reachedEnd: videos.length === 0 ? true : reachedEnd };
}

async function collectVkPhotoComments(
  accessToken: string,
  offset: number,
  ownerId?: string,
): Promise<{ messages: InboxMessage[]; reachedEnd: boolean; unavailable: boolean }> {
  const pageSize = Number(VK_PHOTO_COMMENT_COUNT);
  const params: Record<string, string> = {
    access_token: accessToken,
    count: VK_PHOTO_COMMENT_COUNT,
  };
  if (ownerId) {
    params.owner_id = ownerId;
  }
  if (offset > 0) {
    params.offset = String(offset);
  }
  const payload = ownerId
    ? await vkCallIfAvailable("photos.getAllComments", params)
    : await vkCall("photos.getAllComments", params);
  if (payload === null) {
    return { messages: [], reachedEnd: true, unavailable: true };
  }
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
      url: ownerId ? `https://vk.com/photo${ownerId}_${comment.pid}?reply=${comment.id}` : null,
      receivedAt: comment.date ? new Date(comment.date * 1000).toISOString() : null,
      replyKind: "comment",
    });
  }
  return {
    messages,
    reachedEnd: (parsed.data.items ?? []).length < pageSize,
    unavailable: false,
  };
}

async function collectVkBoardComments(
  accessToken: string,
  topicsPage: VkOffsetPage,
  commentsPage: VkOffsetPage,
  groupId: string,
): Promise<{
  latest: InboxMessage[];
  older: InboxMessage[];
  reachedEnd: boolean;
  commentsReachedEnd: boolean;
  unavailable: boolean;
}> {
  const topicsOffset =
    topicsPage !== 0 && topicsPage !== "done" ? topicsPage * Number(VK_BOARD_TOPIC_COUNT) : null;
  const commentsOffset =
    commentsPage !== 0 && commentsPage !== "done" ? commentsPage * Number(VK_BOARD_COMMENT_COUNT) : null;
  const [latestTopics, olderTopics] = await Promise.all([
    listVkBoardTopics(accessToken, groupId, 0),
    topicsOffset === null
      ? Promise.resolve(emptyVkBoardTopics(true))
      : listVkBoardTopics(accessToken, groupId, topicsOffset),
  ]);
  if (latestTopics.unavailable || olderTopics.unavailable) {
    return {
      latest: [],
      older: [],
      reachedEnd: true,
      commentsReachedEnd: true,
      unavailable: true,
    };
  }
  const commentTopics = [...latestTopics.topics, ...olderTopics.topics];
  const [latest, olderTopic, olderComments] = await Promise.all([
    collectVkCommentsForBoardTopics(accessToken, groupId, latestTopics.topics, 0),
    collectVkCommentsForBoardTopics(accessToken, groupId, olderTopics.topics, 0),
    commentsOffset === null
      ? Promise.resolve(emptyVkCommentPage(true))
      : collectVkCommentsForBoardTopics(accessToken, groupId, commentTopics, commentsOffset),
  ]);
  return {
    latest: latest.messages,
    older: uniqueInboxMessages([...olderTopic.messages, ...olderComments.messages]),
    reachedEnd: olderTopics.reachedEnd,
    commentsReachedEnd: olderComments.reachedEnd,
    unavailable: false,
  };
}

function emptyVkBoardTopics(reachedEnd: boolean): {
  topics: VkBoardTopic[];
  reachedEnd: boolean;
  unavailable: boolean;
} {
  return { topics: [], reachedEnd, unavailable: false };
}

async function listVkBoardTopics(
  accessToken: string,
  groupId: string,
  offset: number,
): Promise<{ topics: VkBoardTopic[]; reachedEnd: boolean; unavailable: boolean }> {
  const pageSize = Number(VK_BOARD_TOPIC_COUNT);
  const params: Record<string, string> = {
    access_token: accessToken,
    group_id: groupId,
    count: VK_BOARD_TOPIC_COUNT,
  };
  if (offset > 0) {
    params.offset = String(offset);
  }
  const payload = await vkCallIfAvailable("board.getTopics", params);
  if (payload === null) {
    return { topics: [], reachedEnd: true, unavailable: true };
  }
  const parsed = wallGetSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("VK board.getTopics returned an unexpected payload");
  }
  const topics = parsed.data.items ?? [];
  return { topics, reachedEnd: topics.length < pageSize, unavailable: false };
}

async function collectVkCommentsForBoardTopics(
  accessToken: string,
  groupId: string,
  topics: VkBoardTopic[],
  offset: number,
): Promise<{ messages: InboxMessage[]; reachedEnd: boolean; nestedAfters: VkThreadMap }> {
  const pageSize = Number(VK_BOARD_COMMENT_COUNT);
  const messages: InboxMessage[] = [];
  let reachedEnd = true;
  for (const topic of topics) {
    const params: Record<string, string> = {
      access_token: accessToken,
      group_id: groupId,
      topic_id: String(topic.id),
      count: VK_BOARD_COMMENT_COUNT,
      sort: "desc",
    };
    if (offset > 0) {
      params.offset = String(offset);
    }
    const commentsPayload = await vkCallIfAvailable("board.getComments", params);
    if (commentsPayload === null) {
      continue;
    }
    const comments = wallCommentsSchema.safeParse(commentsPayload);
    if (!comments.success) {
      throw new SocialError("VK board.getComments returned an unexpected payload");
    }
    if ((comments.data.items ?? []).length >= pageSize) {
      reachedEnd = false;
    }
    messages.push(...vkBoardCommentsToInbox(comments.data.items ?? [], groupId, topic.id));
  }
  return { messages, reachedEnd: topics.length === 0 ? true : reachedEnd, nestedAfters: {} };
}

function vkBoardCommentsToInbox(
  comments: Array<{ id: number; from_id?: number; text?: string; date?: number }>,
  groupId: string,
  topicId: number,
): InboxMessage[] {
  const messages: InboxMessage[] = [];
  const communityFromId = -Number(groupId);
  for (const comment of comments) {
    const text = comment.text?.trim();
    if (!text || comment.from_id === undefined || comment.from_id === communityFromId) {
      continue;
    }
    messages.push({
      externalId: `board:${groupId}:${topicId}:${comment.id}`,
      externalProfileId: String(comment.from_id),
      username: null,
      body: text,
      url: `https://vk.com/topic-${groupId}_${topicId}?post=${comment.id}`,
      receivedAt: comment.date ? new Date(comment.date * 1000).toISOString() : null,
      replyKind: "comment",
    });
  }
  return messages;
}

async function collectVkMarketComments(
  accessToken: string,
  itemsPage: VkOffsetPage,
  commentsPage: VkOffsetPage,
  ownerId: string,
): Promise<{
  latest: InboxMessage[];
  older: InboxMessage[];
  reachedEnd: boolean;
  commentsReachedEnd: boolean;
  unavailable: boolean;
}> {
  const itemsOffset =
    itemsPage !== 0 && itemsPage !== "done" ? itemsPage * Number(VK_MARKET_ITEM_COUNT) : null;
  const commentsOffset =
    commentsPage !== 0 && commentsPage !== "done" ? commentsPage * Number(VK_MARKET_COMMENT_COUNT) : null;
  const [latestItems, olderItems] = await Promise.all([
    listVkMarketItems(accessToken, ownerId, 0),
    itemsOffset === null
      ? Promise.resolve(emptyVkMarketItems(true))
      : listVkMarketItems(accessToken, ownerId, itemsOffset),
  ]);
  if (latestItems.unavailable || olderItems.unavailable) {
    return {
      latest: [],
      older: [],
      reachedEnd: true,
      commentsReachedEnd: true,
      unavailable: true,
    };
  }
  const commentItems = [...latestItems.items, ...olderItems.items];
  const [latest, olderItem, olderComments] = await Promise.all([
    collectVkCommentsForMarketItems(accessToken, ownerId, latestItems.items, 0),
    collectVkCommentsForMarketItems(accessToken, ownerId, olderItems.items, 0),
    commentsOffset === null
      ? Promise.resolve(emptyVkCommentPage(true))
      : collectVkCommentsForMarketItems(accessToken, ownerId, commentItems, commentsOffset),
  ]);
  return {
    latest: latest.messages,
    older: uniqueInboxMessages([...olderItem.messages, ...olderComments.messages]),
    reachedEnd: olderItems.reachedEnd,
    commentsReachedEnd: olderComments.reachedEnd,
    unavailable: false,
  };
}

function emptyVkMarketItems(reachedEnd: boolean): {
  items: VkMarketItem[];
  reachedEnd: boolean;
  unavailable: boolean;
} {
  return { items: [], reachedEnd, unavailable: false };
}

async function listVkMarketItems(
  accessToken: string,
  ownerId: string,
  offset: number,
): Promise<{ items: VkMarketItem[]; reachedEnd: boolean; unavailable: boolean }> {
  const pageSize = Number(VK_MARKET_ITEM_COUNT);
  const params: Record<string, string> = {
    access_token: accessToken,
    owner_id: ownerId,
    count: VK_MARKET_ITEM_COUNT,
  };
  if (offset > 0) {
    params.offset = String(offset);
  }
  const payload = await vkCallIfAvailable("market.get", params);
  if (payload === null) {
    return { items: [], reachedEnd: true, unavailable: true };
  }
  const parsed = wallGetSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("VK market.get returned an unexpected payload");
  }
  const items = parsed.data.items ?? [];
  return { items, reachedEnd: items.length < pageSize, unavailable: false };
}

async function collectVkCommentsForMarketItems(
  accessToken: string,
  ownerId: string,
  items: VkMarketItem[],
  offset: number,
): Promise<{ messages: InboxMessage[]; reachedEnd: boolean; nestedAfters: VkThreadMap }> {
  const pageSize = Number(VK_MARKET_COMMENT_COUNT);
  const messages: InboxMessage[] = [];
  let reachedEnd = true;
  for (const item of items) {
    const params: Record<string, string> = {
      access_token: accessToken,
      owner_id: ownerId,
      item_id: String(item.id),
      count: VK_MARKET_COMMENT_COUNT,
      sort: "desc",
    };
    if (offset > 0) {
      params.offset = String(offset);
    }
    const commentsPayload = await vkCallIfAvailable("market.getComments", params);
    if (commentsPayload === null) {
      continue;
    }
    const comments = wallCommentsSchema.safeParse(commentsPayload);
    if (!comments.success) {
      throw new SocialError("VK market.getComments returned an unexpected payload");
    }
    if ((comments.data.items ?? []).length >= pageSize) {
      reachedEnd = false;
    }
    messages.push(...vkMarketCommentsToInbox(comments.data.items ?? [], ownerId, item.id));
  }
  return { messages, reachedEnd: items.length === 0 ? true : reachedEnd, nestedAfters: {} };
}

function vkMarketCommentsToInbox(
  comments: Array<{ id: number; from_id?: number; text?: string; date?: number }>,
  ownerId: string,
  itemId: number,
): InboxMessage[] {
  const messages: InboxMessage[] = [];
  const communityFromId = Number(ownerId);
  for (const comment of comments) {
    const text = comment.text?.trim();
    if (!text || comment.from_id === undefined || comment.from_id === communityFromId) {
      continue;
    }
    messages.push({
      externalId: `market:${ownerId}:${itemId}:${comment.id}`,
      externalProfileId: String(comment.from_id),
      username: null,
      body: text,
      url: `https://vk.com/market${ownerId}_${itemId}?reply=${comment.id}`,
      receivedAt: comment.date ? new Date(comment.date * 1000).toISOString() : null,
      replyKind: "comment",
    });
  }
  return messages;
}

async function collectVkVideoComments(
  accessToken: string,
  videoPage: VkOffsetPage,
  videocommentsPage: VkOffsetPage,
  videothreadsStored?: string,
  ownerId?: string,
): Promise<{
  latest: InboxMessage[];
  older: InboxMessage[];
  reachedEnd: boolean;
  commentsReachedEnd: boolean;
  videothreads: string;
  unavailable: boolean;
}> {
  const isolate = Boolean(ownerId);
  const videoOffset =
    videoPage !== 0 && videoPage !== "done" ? videoPage * Number(VK_VIDEO_COUNT) : null;
  const commentOffset =
    videocommentsPage !== 0 && videocommentsPage !== "done"
      ? videocommentsPage * Number(VK_VIDEO_COMMENT_COUNT)
      : null;
  const [latestVideos, olderVideos] = await Promise.all([
    listVkVideos(accessToken, 0, ownerId),
    videoOffset === null
      ? Promise.resolve(emptyVkVideos(true))
      : listVkVideos(accessToken, videoOffset, ownerId),
  ]);
  if (latestVideos.unavailable || olderVideos.unavailable) {
    return {
      latest: [],
      older: [],
      reachedEnd: true,
      commentsReachedEnd: true,
      videothreads: "",
      unavailable: true,
    };
  }
  const commentVideos = [...latestVideos.videos, ...olderVideos.videos];
  const [latest, olderVideo, olderComments] = await Promise.all([
    collectVkCommentsForVideos(accessToken, latestVideos.videos, 0, isolate),
    collectVkCommentsForVideos(accessToken, olderVideos.videos, 0, isolate),
    commentOffset === null
      ? Promise.resolve(emptyVkCommentPage(true))
      : collectVkCommentsForVideos(accessToken, commentVideos, commentOffset, isolate),
  ]);
  const storedThreads = decodeVkThreadMap(videothreadsStored);
  const extraThreads =
    storedThreads === null
      ? { messages: [] as InboxMessage[], nextAfters: {} as VkThreadMap, fetchedIds: [] as string[] }
      : await collectVkVideoThreads(accessToken, storedThreads, isolate);
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
    unavailable: false,
  };
}

function emptyVkVideos(reachedEnd: boolean): { videos: VkVideo[]; reachedEnd: boolean; unavailable: boolean } {
  return { videos: [], reachedEnd, unavailable: false };
}

async function listVkVideos(
  accessToken: string,
  offset: number,
  ownerId?: string,
): Promise<{ videos: VkVideo[]; reachedEnd: boolean; unavailable: boolean }> {
  const pageSize = Number(VK_VIDEO_COUNT);
  const params: Record<string, string> = {
    access_token: accessToken,
    count: VK_VIDEO_COUNT,
  };
  if (ownerId) {
    params.owner_id = ownerId;
  }
  if (offset > 0) {
    params.offset = String(offset);
  }
  const payload = ownerId
    ? await vkCallIfAvailable("video.get", params)
    : await vkCall("video.get", params);
  if (payload === null) {
    return { videos: [], reachedEnd: true, unavailable: true };
  }
  const parsed = wallGetSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("VK video.get returned an unexpected payload");
  }
  const videos = parsed.data.items ?? [];
  return { videos, reachedEnd: videos.length < pageSize, unavailable: false };
}

async function collectVkCommentsForVideos(
  accessToken: string,
  videos: VkVideo[],
  offset: number,
  isolate = false,
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
    const commentsPayload = isolate
      ? await vkCallIfAvailable("video.getComments", params)
      : await vkCall("video.getComments", params);
    if (commentsPayload === null) {
      continue;
    }
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
  isolate = false,
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
    const params: Record<string, string> = {
      access_token: accessToken,
      owner_id: ref.ownerId,
      video_id: ref.postId,
      comment_id: ref.commentId,
      count: VK_VIDEO_THREAD_COUNT,
      sort: "desc",
      offset: String(page * pageSize),
    };
    const commentsPayload = isolate
      ? await vkCallIfAvailable("video.getComments", params)
      : await vkCall("video.getComments", params);
    if (commentsPayload === null) {
      continue;
    }
    fetchedIds.push(id);
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
  wallthreadsStored: string | undefined,
  wallrepostsPage: VkOffsetPage,
): Promise<{
  latest: InboxMessage[];
  older: InboxMessage[];
  latestReposts: InboxMessage[];
  olderReposts: InboxMessage[];
  reachedEnd: boolean;
  commentsReachedEnd: boolean;
  repostsReachedEnd: boolean;
  wallthreads: string;
}> {
  const wallOffset =
    wallPage !== 0 && wallPage !== "done" ? wallPage * Number(VK_WALL_COUNT) : null;
  const commentOffset =
    wallcommentsPage !== 0 && wallcommentsPage !== "done"
      ? wallcommentsPage * Number(VK_WALL_COMMENT_COUNT)
      : null;
  const repostOffset =
    wallrepostsPage !== 0 && wallrepostsPage !== "done"
      ? wallrepostsPage * Number(VK_WALL_REPOST_COUNT)
      : null;
  const [latestPosts, olderPosts] = await Promise.all([
    listVkWallPosts(accessToken, metadata, 0),
    wallOffset === null
      ? Promise.resolve(emptyVkWallPosts(true))
      : listVkWallPosts(accessToken, metadata, wallOffset),
  ]);
  const commentPosts = [...latestPosts.posts, ...olderPosts.posts];
  const [latest, olderWall, olderComments, latestReposts, olderWallReposts, olderReposts] = await Promise.all([
    collectVkCommentsForPosts(accessToken, metadata, latestPosts.posts, 0),
    collectVkCommentsForPosts(accessToken, metadata, olderPosts.posts, 0),
    commentOffset === null
      ? Promise.resolve(emptyVkCommentPage(true))
      : collectVkCommentsForPosts(accessToken, metadata, commentPosts, commentOffset),
    collectVkRepostsForPosts(accessToken, metadata, latestPosts.posts, 0),
    collectVkRepostsForPosts(accessToken, metadata, olderPosts.posts, 0),
    repostOffset === null
      ? Promise.resolve(emptyVkRepostPage(true))
      : collectVkRepostsForPosts(accessToken, metadata, commentPosts, repostOffset),
  ]);
  const storedThreads = decodeVkThreadMap(wallthreadsStored);
  const extraThreads =
    storedThreads === null
      ? { messages: [] as InboxMessage[], nextAfters: {} as VkThreadMap, fetchedIds: [] as string[] }
      : await collectVkWallThreads(accessToken, storedThreads);
  return {
    latest: latest.messages,
    older: uniqueInboxMessages([...olderWall.messages, ...olderComments.messages, ...extraThreads.messages]),
    latestReposts: latestReposts.messages,
    olderReposts: uniqueInboxMessages([...olderWallReposts.messages, ...olderReposts.messages]),
    reachedEnd: olderPosts.reachedEnd,
    commentsReachedEnd: olderComments.reachedEnd,
    repostsReachedEnd: olderReposts.reachedEnd,
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

function emptyVkRepostPage(reachedEnd: boolean): { messages: InboxMessage[]; reachedEnd: boolean } {
  return { messages: [], reachedEnd };
}

async function collectVkRepostsForPosts(
  accessToken: string,
  metadata: Record<string, unknown> | undefined,
  posts: VkWallPost[],
  offset: number,
): Promise<{ messages: InboxMessage[]; reachedEnd: boolean }> {
  const target = vkWallTarget(metadata);
  const pageSize = Number(VK_WALL_REPOST_COUNT);
  const messages: InboxMessage[] = [];
  let reachedEnd = true;
  for (const post of posts) {
    const params: Record<string, string> = {
      access_token: accessToken,
      post_id: String(post.id),
      count: VK_WALL_REPOST_COUNT,
    };
    const ownerId = post.owner_id ?? (target.ownerId ? Number(target.ownerId) : null);
    if (ownerId !== null) {
      params.owner_id = String(ownerId);
    }
    if (offset > 0) {
      params.offset = String(offset);
    }
    const payload = await vkCall("wall.getReposts", params);
    const parsed = wallRepostsSchema.safeParse(payload);
    if (!parsed.success) {
      throw new SocialError("VK wall.getReposts returned an unexpected payload");
    }
    const items = parsed.data.items ?? [];
    if (items.length >= pageSize) {
      reachedEnd = false;
    }
    for (const item of items) {
      const message = vkWallRepostMessage(item, ownerId);
      if (message) {
        messages.push(message);
      }
    }
  }
  return { messages, reachedEnd: posts.length === 0 ? true : reachedEnd };
}

function vkWallRepostMessage(
  item: {
    id: number;
    owner_id?: number;
    from_id?: number;
    date?: number;
    text?: string;
  },
  originalOwnerId: number | null,
): InboxMessage | null {
  const text = item.text?.trim();
  const ownerId = item.owner_id;
  const fromId = item.from_id;
  if (!text || ownerId === undefined || fromId === undefined) {
    return null;
  }
  if (originalOwnerId !== null && fromId === originalOwnerId) {
    return null;
  }
  return {
    externalId: `repost:${ownerId}:${item.id}`,
    externalProfileId: String(fromId),
    username: null,
    body: text,
    url: `https://vk.com/wall${ownerId}_${item.id}`,
    receivedAt: item.date ? new Date(item.date * 1000).toISOString() : null,
    replyKind: "mention",
  };
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

export function parseVkInboxRepostRef(externalId: string): {
  ownerId: string;
  postId: string;
} {
  const parts = externalId.split(":");
  const ownerId = parts[1];
  const postId = parts[2];
  if (
    parts[0] !== "repost" ||
    parts.length !== 3 ||
    !ownerId ||
    !postId ||
    !/^-?\d+$/.test(ownerId) ||
    !/^\d+$/.test(postId)
  ) {
    throw new ValidationError("VK wall repost replies require owner and post ids from wall.getReposts");
  }
  return { ownerId, postId };
}

export function parseVkInboxVideoTagRef(externalId: string): {
  ownerId: string;
  videoId: string;
} {
  const parts = externalId.split(":");
  const ownerId = parts[1];
  const videoId = parts[2];
  if (
    parts[0] !== "videotag" ||
    parts.length !== 3 ||
    !ownerId ||
    !videoId ||
    !/^-?\d+$/.test(ownerId) ||
    !/^\d+$/.test(videoId)
  ) {
    throw new ValidationError("VK video tag replies require owner and video ids from video.getUserVideos");
  }
  return { ownerId, videoId };
}

export function parseVkInboxVideoTagCommentRef(externalId: string): {
  ownerId: string;
  videoId: string;
  commentId: string;
} {
  const parts = externalId.split(":");
  const ownerId = parts[1];
  const videoId = parts[2];
  const commentId = parts[3];
  if (
    parts[0] !== "videotag" ||
    parts.length !== 4 ||
    !ownerId ||
    !videoId ||
    !commentId ||
    !/^-?\d+$/.test(ownerId) ||
    !/^\d+$/.test(videoId) ||
    !/^\d+$/.test(commentId)
  ) {
    throw new ValidationError(
      "VK tagged video comment replies require owner, video, and comment ids from video.getComments",
    );
  }
  return { ownerId, videoId, commentId };
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

export function parseVkInboxBoardCommentRef(externalId: string): {
  groupId: string;
  topicId: string;
  commentId: string;
} {
  const parts = externalId.split(":");
  const groupId = parts[1];
  const topicId = parts[2];
  const commentId = parts[3];
  if (
    parts[0] !== "board" ||
    parts.length !== 4 ||
    !groupId ||
    !topicId ||
    !commentId ||
    !/^\d+$/.test(groupId) ||
    !/^\d+$/.test(topicId) ||
    !/^\d+$/.test(commentId)
  ) {
    throw new ValidationError("VK board comment replies require group, topic, and comment ids from board.getComments");
  }
  return { groupId, topicId, commentId };
}

export function parseVkInboxMarketCommentRef(externalId: string): {
  ownerId: string;
  itemId: string;
  commentId: string;
} {
  const parts = externalId.split(":");
  const ownerId = parts[1];
  const itemId = parts[2];
  const commentId = parts[3];
  if (
    parts[0] !== "market" ||
    parts.length !== 4 ||
    !ownerId ||
    !itemId ||
    !commentId ||
    !/^-?\d+$/.test(ownerId) ||
    !/^\d+$/.test(itemId) ||
    !/^\d+$/.test(commentId)
  ) {
    throw new ValidationError("VK market comment replies require owner, item, and comment ids from market.getComments");
  }
  return { ownerId, itemId, commentId };
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

export async function replyToVkWallRepost(
  accessToken: string,
  input: { externalId: string; text: string },
): Promise<{ externalMessageId: string }> {
  const text = input.text.trim();
  if (!text) {
    throw new ValidationError("VK wall repost replies require a body");
  }

  const ref = parseVkInboxRepostRef(input.externalId);
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

export async function replyToVkVideoTag(
  accessToken: string,
  input: { externalId: string; text: string },
): Promise<{ externalMessageId: string }> {
  const text = input.text.trim();
  if (!text) {
    throw new ValidationError("VK video tag replies require a body");
  }

  const ref = parseVkInboxVideoTagRef(input.externalId);
  const payload = await vkCall("video.createComment", {
    access_token: accessToken,
    owner_id: ref.ownerId,
    video_id: ref.videoId,
    message: text,
  });
  const parsed = z.number().safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("VK video.createComment returned an unexpected payload");
  }
  return { externalMessageId: String(parsed.data) };
}

export async function replyToVkUserVideoComment(
  accessToken: string,
  input: { externalId: string; text: string },
): Promise<{ externalMessageId: string }> {
  const text = input.text.trim();
  if (!text) {
    throw new ValidationError("VK tagged video comment replies require a body");
  }

  const ref = parseVkInboxVideoTagCommentRef(input.externalId);
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
  input: { externalId: string; text: string; ownerId?: string },
): Promise<{ externalMessageId: string }> {
  const text = input.text.trim();
  if (!text) {
    throw new ValidationError("VK photo comment replies require a body");
  }

  const ref = parseVkInboxPhotoCommentRef(input.externalId);
  const params: Record<string, string> = {
    access_token: accessToken,
    photo_id: ref.photoId,
    reply_to_comment: ref.commentId,
    message: text,
  };
  if (input.ownerId) {
    params.owner_id = input.ownerId;
  }
  const payload = await vkCall("photos.createComment", params);
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

export async function replyToVkBoardComment(
  accessToken: string,
  input: { externalId: string; text: string; fromGroup?: boolean },
): Promise<{ externalMessageId: string }> {
  const text = input.text.trim();
  if (!text) {
    throw new ValidationError("VK board comment replies require a body");
  }

  const ref = parseVkInboxBoardCommentRef(input.externalId);
  const params: Record<string, string> = {
    access_token: accessToken,
    group_id: ref.groupId,
    topic_id: ref.topicId,
    message: text,
  };
  if (input.fromGroup) {
    params.from_group = "1";
  }
  const payload = await vkCall("board.createComment", params);
  const parsed = z.number().safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("VK board.createComment returned an unexpected payload");
  }
  return { externalMessageId: String(parsed.data) };
}

export async function replyToVkMarketComment(
  accessToken: string,
  input: { externalId: string; text: string; fromGroup?: boolean },
): Promise<{ externalMessageId: string }> {
  const text = input.text.trim();
  if (!text) {
    throw new ValidationError("VK market comment replies require a body");
  }

  const ref = parseVkInboxMarketCommentRef(input.externalId);
  const params: Record<string, string> = {
    access_token: accessToken,
    owner_id: ref.ownerId,
    item_id: ref.itemId,
    reply_to_comment: ref.commentId,
    message: text,
  };
  if (input.fromGroup) {
    params.from_group = "1";
  }
  const payload = await vkCall("market.createComment", params);
  const parsed = z.number().safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("VK market.createComment returned an unexpected payload");
  }
  return { externalMessageId: String(parsed.data) };
}
