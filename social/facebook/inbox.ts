import { z } from "zod";
import { SocialError, ValidationError } from "@/lib/errors";
import {
  filterMessagesAfterCursor,
  newestReceivedAt,
  serializeNamedInboxCursor,
  parseNamedInboxCursor,
  laterTimestampString,
  uniqueInboxMessages,
} from "@/lib/inbox/cursor";
import { readJson, socialFetch } from "@/social/core/http";
import type { InboxInput, InboxMessage, InboxResult } from "@/social/core/adapter";
import { FACEBOOK_GRAPH_ORIGIN } from "@/social/facebook/graph";
import { resolveFacebookPage, type FacebookPageAuth } from "@/social/facebook/pages";
import { throwIfGraphError } from "@/social/meta/graph-error";
import {
  decodeGraphAfter,
  decodeGraphReplies,
  GRAPH_OBJECT_ID,
  GRAPH_REPLIES_FETCH_LIMIT,
  graphPagingAfter,
  graphPagingSchema,
  nextGraphAfterCursor,
  nextGraphRepliesCursor,
  type GraphRepliesMap,
} from "@/social/meta/graph-paging";

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
                      paging: graphPagingSchema,
                    })
                    .optional(),
                }),
              )
              .optional(),
            paging: graphPagingSchema,
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
            paging: graphPagingSchema,
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

async function collectFacebookComments(
  page: FacebookPageAuth,
  after?: string | null,
): Promise<{
  messages: InboxMessage[];
  nextAfter: string | null;
  repliesAfter: GraphRepliesMap;
  crepliesAfter: GraphRepliesMap;
}> {
  const url = new URL(`${FACEBOOK_GRAPH_ORIGIN}/${page.id}/feed`);
  url.searchParams.set("fields", "id,comments.limit(50){id,from,message,created_time,comments.limit(25){id,from,message,created_time}}");
  url.searchParams.set("limit", "10");
  url.searchParams.set("access_token", page.accessToken);
  if (after) {
    url.searchParams.set("after", after);
  }
  const response = await socialFetch(url.toString());
  const payload = await readJson<unknown>(response);
  throwIfGraphError(payload);
  const parsed = commentsSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("Facebook Page comments returned an unexpected payload");
  }

  const messages: InboxMessage[] = [];
  const repliesAfter: GraphRepliesMap = {};
  const crepliesAfter: GraphRepliesMap = {};
  for (const post of parsed.data.data ?? []) {
    const nestedAfter = graphPagingAfter(post.comments);
    if (nestedAfter && GRAPH_OBJECT_ID.test(post.id)) {
      repliesAfter[post.id] = nestedAfter;
    }
    for (const comment of post.comments?.data ?? []) {
      pushFacebookComment(messages, comment, page.id);
      const replyAfter = graphPagingAfter(comment.comments);
      if (replyAfter && GRAPH_OBJECT_ID.test(comment.id)) {
        crepliesAfter[comment.id] = replyAfter;
      }
      for (const reply of comment.comments?.data ?? []) {
        pushFacebookComment(messages, reply, page.id);
      }
    }
  }
  return { messages, nextAfter: graphPagingAfter(payload), repliesAfter, crepliesAfter };
}

function pushFacebookComment(
  messages: InboxMessage[],
  comment: {
    id: string;
    message?: string;
    created_time?: string;
    from?: { id?: string; name?: string };
  },
  pageId: string,
): void {
  const fromId = comment.from?.id;
  const text = comment.message?.trim();
  if (!fromId || !text || fromId === pageId) {
    return;
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

const facebookCommentEdgeSchema = z.object({
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
            paging: graphPagingSchema,
          })
          .optional(),
      }),
    )
    .optional(),
  paging: graphPagingSchema,
});

async function collectFacebookCommentReplies(
  page: FacebookPageAuth,
  stored: GraphRepliesMap,
): Promise<{
  messages: InboxMessage[];
  nextAfters: GraphRepliesMap;
  fetchedIds: string[];
  crepliesAfter: GraphRepliesMap;
}> {
  const messages: InboxMessage[] = [];
  const nextAfters: GraphRepliesMap = {};
  const crepliesAfter: GraphRepliesMap = {};
  const ids = Object.keys(stored).filter((id) => GRAPH_OBJECT_ID.test(id)).slice(0, GRAPH_REPLIES_FETCH_LIMIT);
  for (const objectId of ids) {
    const after = stored[objectId];
    if (!after) {
      continue;
    }
    const url = new URL(`${FACEBOOK_GRAPH_ORIGIN}/${objectId}/comments`);
    url.searchParams.set(
      "fields",
      "id,from,message,created_time,comments.limit(25){id,from,message,created_time}",
    );
    url.searchParams.set("limit", "50");
    url.searchParams.set("after", after);
    url.searchParams.set("access_token", page.accessToken);
    const response = await socialFetch(url.toString());
    const payload = await readJson<unknown>(response);
    throwIfGraphError(payload);
    const parsed = facebookCommentEdgeSchema.safeParse(payload);
    if (!parsed.success) {
      throw new SocialError("Facebook comment page returned an unexpected payload");
    }
    const nextAfter = graphPagingAfter(payload);
    if (nextAfter) {
      nextAfters[objectId] = nextAfter;
    }
    for (const comment of parsed.data.data ?? []) {
      pushFacebookComment(messages, comment, page.id);
      const replyAfter = graphPagingAfter(comment.comments);
      if (replyAfter && GRAPH_OBJECT_ID.test(comment.id)) {
        crepliesAfter[comment.id] = replyAfter;
      }
      for (const reply of comment.comments?.data ?? []) {
        pushFacebookComment(messages, reply, page.id);
      }
    }
  }
  return { messages, nextAfters, fetchedIds: ids, crepliesAfter };
}

async function collectFacebookNestedCommentReplies(
  page: FacebookPageAuth,
  stored: GraphRepliesMap,
): Promise<{ messages: InboxMessage[]; nextAfters: GraphRepliesMap; fetchedIds: string[] }> {
  const messages: InboxMessage[] = [];
  const nextAfters: GraphRepliesMap = {};
  const ids = Object.keys(stored).filter((id) => GRAPH_OBJECT_ID.test(id)).slice(0, GRAPH_REPLIES_FETCH_LIMIT);
  for (const objectId of ids) {
    const after = stored[objectId];
    if (!after) {
      continue;
    }
    const url = new URL(`${FACEBOOK_GRAPH_ORIGIN}/${objectId}/comments`);
    url.searchParams.set("fields", "id,from,message,created_time");
    url.searchParams.set("limit", "25");
    url.searchParams.set("after", after);
    url.searchParams.set("access_token", page.accessToken);
    const response = await socialFetch(url.toString());
    const payload = await readJson<unknown>(response);
    throwIfGraphError(payload);
    const parsed = facebookCommentEdgeSchema.safeParse(payload);
    if (!parsed.success) {
      throw new SocialError("Facebook comment replies returned an unexpected payload");
    }
    const nextAfter = graphPagingAfter(payload);
    if (nextAfter) {
      nextAfters[objectId] = nextAfter;
    }
    for (const comment of parsed.data.data ?? []) {
      pushFacebookComment(messages, comment, page.id);
    }
  }
  return { messages, nextAfters, fetchedIds: ids };
}

const facebookMessageEdgeSchema = z.object({
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
  paging: graphPagingSchema,
});

type FacebookConversationFolder = "other" | "page_done" | "pending";
const FACEBOOK_OTHER_CONVERSATION_FOLDER: FacebookConversationFolder = "other";
const FACEBOOK_DONE_CONVERSATION_FOLDER: FacebookConversationFolder = "page_done";
const FACEBOOK_PENDING_CONVERSATION_FOLDER: FacebookConversationFolder = "pending";

async function collectFacebookMessenger(
  page: FacebookPageAuth,
  after?: string | null,
  folder?: FacebookConversationFolder,
): Promise<{ messages: InboxMessage[]; nextAfter: string | null; threadAfters: GraphRepliesMap }> {
  const url = new URL(`${FACEBOOK_GRAPH_ORIGIN}/${page.id}/conversations`);
  url.searchParams.set("platform", "MESSENGER");
  url.searchParams.set("fields", "id,messages.limit(20){id,message,from,created_time}");
  url.searchParams.set("limit", "15");
  url.searchParams.set("access_token", page.accessToken);
  if (folder) {
    url.searchParams.set("folder", folder);
  }
  if (after) {
    url.searchParams.set("after", after);
  }
  const response = await socialFetch(url.toString());
  const payload = await readJson<unknown>(response);
  throwIfGraphError(payload);
  const parsed = conversationsSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("Facebook Page conversations returned an unexpected payload");
  }
  const threadAfters: GraphRepliesMap = {};
  for (const thread of parsed.data.data ?? []) {
    const nestedAfter = graphPagingAfter(thread.messages);
    if (nestedAfter && thread.id && GRAPH_OBJECT_ID.test(thread.id)) {
      threadAfters[thread.id] = nestedAfter;
    }
  }
  return {
    messages: parseFacebookMessengerConversations(payload, page.id),
    nextAfter: graphPagingAfter(payload),
    threadAfters,
  };
}

async function collectFacebookThreadMessages(
  page: FacebookPageAuth,
  stored: GraphRepliesMap,
): Promise<{ messages: InboxMessage[]; nextAfters: GraphRepliesMap; fetchedIds: string[] }> {
  const messages: InboxMessage[] = [];
  const nextAfters: GraphRepliesMap = {};
  const ids = Object.keys(stored).filter((id) => GRAPH_OBJECT_ID.test(id)).slice(0, GRAPH_REPLIES_FETCH_LIMIT);
  for (const objectId of ids) {
    const after = stored[objectId];
    if (!after) {
      continue;
    }
    const url = new URL(`${FACEBOOK_GRAPH_ORIGIN}/${objectId}/messages`);
    url.searchParams.set("fields", "id,message,from,created_time");
    url.searchParams.set("limit", "20");
    url.searchParams.set("after", after);
    url.searchParams.set("access_token", page.accessToken);
    const response = await socialFetch(url.toString());
    const payload = await readJson<unknown>(response);
    throwIfGraphError(payload);
    const parsed = facebookMessageEdgeSchema.safeParse(payload);
    if (!parsed.success) {
      throw new SocialError("Facebook conversation messages returned an unexpected payload");
    }
    const nextAfter = graphPagingAfter(payload);
    if (nextAfter) {
      nextAfters[objectId] = nextAfter;
    }
    for (const event of parsed.data.data ?? []) {
      const fromId = event.from?.id !== undefined ? String(event.from.id) : "";
      const text = event.message?.trim();
      if (!fromId || !text || fromId === page.id) {
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
  return { messages, nextAfters, fetchedIds: ids };
}

const facebookTaggedSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string().min(1),
        message: z.string().optional(),
        created_time: z.string().optional(),
        permalink_url: z.string().optional(),
        from: z
          .object({
            id: z.union([z.string(), z.number()]).optional(),
            name: z.string().optional(),
          })
          .optional(),
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
                      paging: graphPagingSchema,
                    })
                    .optional(),
                }),
              )
              .optional(),
            paging: graphPagingSchema,
          })
          .optional(),
      }),
    )
    .optional(),
  paging: graphPagingSchema,
});

async function collectFacebookTagged(
  page: FacebookPageAuth,
  after?: string | null,
): Promise<{
  messages: InboxMessage[];
  commentMessages: InboxMessage[];
  nextAfter: string | null;
  repliesAfter: GraphRepliesMap;
  crepliesAfter: GraphRepliesMap;
}> {
  const url = new URL(`${FACEBOOK_GRAPH_ORIGIN}/${page.id}/tagged`);
  url.searchParams.set(
    "fields",
    "id,from,message,created_time,permalink_url,comments.limit(50){id,from,message,created_time,comments.limit(25){id,from,message,created_time}}",
  );
  url.searchParams.set("limit", "10");
  url.searchParams.set("access_token", page.accessToken);
  if (after) {
    url.searchParams.set("after", after);
  }
  const response = await socialFetch(url.toString());
  const payload = await readJson<unknown>(response);
  throwIfGraphError(payload);
  const parsed = facebookTaggedSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("Facebook Page tagged posts returned an unexpected payload");
  }
  const messages: InboxMessage[] = [];
  const commentMessages: InboxMessage[] = [];
  const repliesAfter: GraphRepliesMap = {};
  const crepliesAfter: GraphRepliesMap = {};
  for (const post of parsed.data.data ?? []) {
    const nestedAfter = graphPagingAfter(post.comments);
    if (nestedAfter && GRAPH_OBJECT_ID.test(post.id)) {
      repliesAfter[post.id] = nestedAfter;
    }
    for (const comment of post.comments?.data ?? []) {
      pushFacebookComment(commentMessages, comment, page.id);
      const replyAfter = graphPagingAfter(comment.comments);
      if (replyAfter && GRAPH_OBJECT_ID.test(comment.id)) {
        crepliesAfter[comment.id] = replyAfter;
      }
      for (const reply of comment.comments?.data ?? []) {
        pushFacebookComment(commentMessages, reply, page.id);
      }
    }
    const fromId = post.from?.id !== undefined ? String(post.from.id) : "";
    const text = post.message?.trim();
    if (!fromId || !text || fromId === page.id) {
      continue;
    }
    messages.push({
      externalId: post.id,
      externalProfileId: fromId,
      username: post.from?.name ?? null,
      body: text,
      url: post.permalink_url?.trim() || `https://www.facebook.com/${post.id}`,
      receivedAt: post.created_time ?? null,
      replyKind: "mention",
    });
  }
  return { messages, commentMessages, nextAfter: graphPagingAfter(payload), repliesAfter, crepliesAfter };
}

const facebookRatingsSchema = z.object({
  data: z
    .array(
      z.object({
        created_time: z.string().optional(),
        review_text: z.string().optional(),
        reviewer: z
          .object({
            id: z.union([z.string(), z.number()]).optional(),
            name: z.string().optional(),
          })
          .optional(),
        open_graph_story: z
          .object({
            id: z.string().min(1).optional(),
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
                          paging: graphPagingSchema,
                        })
                        .optional(),
                    }),
                  )
                  .optional(),
                paging: graphPagingSchema,
              })
              .optional(),
          })
          .optional(),
      }),
    )
    .optional(),
  paging: graphPagingSchema,
});

async function collectFacebookRatings(
  page: FacebookPageAuth,
  after?: string | null,
): Promise<{
  messages: InboxMessage[];
  commentMessages: InboxMessage[];
  nextAfter: string | null;
  repliesAfter: GraphRepliesMap;
  crepliesAfter: GraphRepliesMap;
}> {
  const url = new URL(`${FACEBOOK_GRAPH_ORIGIN}/${page.id}/ratings`);
  url.searchParams.set(
    "fields",
    "created_time,review_text,reviewer,open_graph_story{id,comments.limit(50){id,from,message,created_time,comments.limit(25){id,from,message,created_time}}}",
  );
  url.searchParams.set("limit", "10");
  url.searchParams.set("access_token", page.accessToken);
  if (after) {
    url.searchParams.set("after", after);
  }
  const response = await socialFetch(url.toString());
  const payload = await readJson<unknown>(response);
  throwIfGraphError(payload);
  const parsed = facebookRatingsSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("Facebook Page ratings returned an unexpected payload");
  }
  const messages: InboxMessage[] = [];
  const commentMessages: InboxMessage[] = [];
  const repliesAfter: GraphRepliesMap = {};
  const crepliesAfter: GraphRepliesMap = {};
  for (const rating of parsed.data.data ?? []) {
    const storyId = rating.open_graph_story?.id?.trim();
    if (storyId && GRAPH_OBJECT_ID.test(storyId)) {
      const nestedAfter = graphPagingAfter(rating.open_graph_story?.comments);
      if (nestedAfter) {
        repliesAfter[storyId] = nestedAfter;
      }
      for (const comment of rating.open_graph_story?.comments?.data ?? []) {
        pushFacebookComment(commentMessages, comment, page.id);
        const replyAfter = graphPagingAfter(comment.comments);
        if (replyAfter && GRAPH_OBJECT_ID.test(comment.id)) {
          crepliesAfter[comment.id] = replyAfter;
        }
        for (const reply of comment.comments?.data ?? []) {
          pushFacebookComment(commentMessages, reply, page.id);
        }
      }
    }
    const fromId = rating.reviewer?.id !== undefined ? String(rating.reviewer.id) : "";
    const text = rating.review_text?.trim();
    if (!storyId || !fromId || !text) {
      continue;
    }
    messages.push({
      externalId: storyId,
      externalProfileId: fromId,
      username: rating.reviewer?.name ?? null,
      body: text,
      url: `https://www.facebook.com/${storyId}`,
      receivedAt: rating.created_time ?? null,
      replyKind: "comment",
    });
  }
  return { messages, commentMessages, nextAfter: graphPagingAfter(payload), repliesAfter, crepliesAfter };
}

export async function collectFacebookInbox(
  userAccessToken: string,
  metadata: Record<string, unknown> | undefined,
  input: InboxInput,
): Promise<InboxResult> {
  const page = await resolveFacebookPage(userAccessToken, metadata);
  const cursor = parseNamedInboxCursor(input.cursor);
  const olderThreadAfter = decodeGraphAfter(cursor.threads);
  const olderOtherAfter = decodeGraphAfter(cursor.otherthreads);
  const olderDoneAfter = decodeGraphAfter(cursor.donethreads);
  const olderPendingAfter = decodeGraphAfter(cursor.pendingthreads);
  const olderPostsAfter = decodeGraphAfter(cursor.posts);
  const storedReplies = decodeGraphReplies(cursor.replies);
  const storedCreplies = decodeGraphReplies(cursor.creplies);
  const storedThreadMsgs = decodeGraphReplies(cursor.threadmsgs);
  const olderTaggedAfter = decodeGraphAfter(cursor.tagged);
  const storedTaggedReplies = decodeGraphReplies(cursor.taggedreplies);
  const olderRatingsAfter = decodeGraphAfter(cursor.ratings);
  const storedRatingReplies = decodeGraphReplies(cursor.ratingreplies);
  const emptyPage = {
    messages: [] as InboxMessage[],
    nextAfter: null,
    repliesAfter: {} as GraphRepliesMap,
    crepliesAfter: {} as GraphRepliesMap,
  };
  const emptyDirect = { messages: [] as InboxMessage[], nextAfter: null, threadAfters: {} as GraphRepliesMap };
  const emptyReplies = {
    messages: [] as InboxMessage[],
    nextAfters: {} as GraphRepliesMap,
    fetchedIds: [] as string[],
    crepliesAfter: {} as GraphRepliesMap,
  };
  const emptyNested = {
    messages: [] as InboxMessage[],
    nextAfters: {} as GraphRepliesMap,
    fetchedIds: [] as string[],
  };
  const emptyTagged = {
    messages: [] as InboxMessage[],
    commentMessages: [] as InboxMessage[],
    nextAfter: null,
    repliesAfter: {} as GraphRepliesMap,
    crepliesAfter: {} as GraphRepliesMap,
  };
  const emptyRatings = {
    messages: [] as InboxMessage[],
    commentMessages: [] as InboxMessage[],
    nextAfter: null,
    repliesAfter: {} as GraphRepliesMap,
    crepliesAfter: {} as GraphRepliesMap,
  };
  const [
    latestComments,
    olderComments,
    extraReplies,
    extraCreplies,
    latestDirect,
    olderDirect,
    extraThreadMsgs,
    latestOther,
    olderOther,
    latestDone,
    olderDone,
    latestPending,
    olderPending,
    latestTagged,
    olderTagged,
    extraTaggedReplies,
    latestRatings,
    olderRatings,
    extraRatingReplies,
  ] = await Promise.all([
      collectFacebookComments(page),
      olderPostsAfter ? collectFacebookComments(page, olderPostsAfter) : Promise.resolve(emptyPage),
      storedReplies ? collectFacebookCommentReplies(page, storedReplies) : Promise.resolve(emptyReplies),
      storedCreplies ? collectFacebookNestedCommentReplies(page, storedCreplies) : Promise.resolve(emptyNested),
      collectFacebookMessenger(page),
      olderThreadAfter ? collectFacebookMessenger(page, olderThreadAfter) : Promise.resolve(emptyDirect),
      storedThreadMsgs
        ? collectFacebookThreadMessages(page, storedThreadMsgs)
        : Promise.resolve(emptyNested),
      collectFacebookMessenger(page, null, FACEBOOK_OTHER_CONVERSATION_FOLDER),
      olderOtherAfter
        ? collectFacebookMessenger(page, olderOtherAfter, FACEBOOK_OTHER_CONVERSATION_FOLDER)
        : Promise.resolve(emptyDirect),
      collectFacebookMessenger(page, null, FACEBOOK_DONE_CONVERSATION_FOLDER),
      olderDoneAfter
        ? collectFacebookMessenger(page, olderDoneAfter, FACEBOOK_DONE_CONVERSATION_FOLDER)
        : Promise.resolve(emptyDirect),
      collectFacebookMessenger(page, null, FACEBOOK_PENDING_CONVERSATION_FOLDER),
      olderPendingAfter
        ? collectFacebookMessenger(page, olderPendingAfter, FACEBOOK_PENDING_CONVERSATION_FOLDER)
        : Promise.resolve(emptyDirect),
      collectFacebookTagged(page),
      olderTaggedAfter ? collectFacebookTagged(page, olderTaggedAfter) : Promise.resolve(emptyTagged),
      storedTaggedReplies
        ? collectFacebookCommentReplies(page, storedTaggedReplies)
        : Promise.resolve(emptyReplies),
      collectFacebookRatings(page),
      olderRatingsAfter ? collectFacebookRatings(page, olderRatingsAfter) : Promise.resolve(emptyRatings),
      storedRatingReplies
        ? collectFacebookCommentReplies(page, storedRatingReplies)
        : Promise.resolve(emptyReplies),
    ]);
  const comments = uniqueInboxMessages([
    ...filterMessagesAfterCursor(latestComments.messages, cursor.comments),
    ...olderComments.messages,
    ...extraReplies.messages,
    ...extraCreplies.messages,
    ...filterMessagesAfterCursor(latestTagged.commentMessages, cursor.comments),
    ...olderTagged.commentMessages,
    ...extraTaggedReplies.messages,
    ...filterMessagesAfterCursor(latestRatings.commentMessages, cursor.comments),
    ...olderRatings.commentMessages,
    ...extraRatingReplies.messages,
  ]);
  const latestMessages = latestDirect.messages;
  const olderMessages = olderDirect.messages;
  return {
    messages: [
      ...comments,
      ...uniqueInboxMessages([
        ...filterMessagesAfterCursor(latestTagged.messages, cursor.mentions),
        ...olderTagged.messages,
      ]),
      ...uniqueInboxMessages([
        ...filterMessagesAfterCursor(latestRatings.messages, cursor.reviews),
        ...olderRatings.messages,
      ]),
      ...uniqueInboxMessages([
        ...filterMessagesAfterCursor(latestMessages, cursor.messages),
        ...olderMessages,
        ...filterMessagesAfterCursor(latestOther.messages, cursor.messages),
        ...olderOther.messages,
        ...filterMessagesAfterCursor(latestDone.messages, cursor.messages),
        ...olderDone.messages,
        ...filterMessagesAfterCursor(latestPending.messages, cursor.messages),
        ...olderPending.messages,
        ...extraThreadMsgs.messages,
      ]),
    ],
    cursor: serializeNamedInboxCursor({
      comments:
        laterTimestampString(
          cursor.comments,
          newestReceivedAt([
            ...latestComments.messages,
            ...olderComments.messages,
            ...extraReplies.messages,
            ...extraCreplies.messages,
            ...latestTagged.commentMessages,
            ...olderTagged.commentMessages,
            ...extraTaggedReplies.messages,
            ...latestRatings.commentMessages,
            ...olderRatings.commentMessages,
            ...extraRatingReplies.messages,
          ]),
        ) ?? "",
      messages:
        laterTimestampString(
          cursor.messages,
          newestReceivedAt([
            ...latestMessages,
            ...olderMessages,
            ...latestOther.messages,
            ...olderOther.messages,
            ...latestDone.messages,
            ...olderDone.messages,
            ...latestPending.messages,
            ...olderPending.messages,
            ...extraThreadMsgs.messages,
          ]),
        ) ?? "",
      donethreads: nextGraphAfterCursor({
        stored: cursor.donethreads,
        firstPageAfter: latestDone.nextAfter,
        olderPageAfter: olderDone.nextAfter,
        fetchedOlder: Boolean(olderDoneAfter),
      }),
      otherthreads: nextGraphAfterCursor({
        stored: cursor.otherthreads,
        firstPageAfter: latestOther.nextAfter,
        olderPageAfter: olderOther.nextAfter,
        fetchedOlder: Boolean(olderOtherAfter),
      }),
      pendingthreads: nextGraphAfterCursor({
        stored: cursor.pendingthreads,
        firstPageAfter: latestPending.nextAfter,
        olderPageAfter: olderPending.nextAfter,
        fetchedOlder: Boolean(olderPendingAfter),
      }),
      posts: nextGraphAfterCursor({
        stored: cursor.posts,
        firstPageAfter: latestComments.nextAfter,
        olderPageAfter: olderComments.nextAfter,
        fetchedOlder: Boolean(olderPostsAfter),
      }),
      ratings: nextGraphAfterCursor({
        stored: cursor.ratings,
        firstPageAfter: latestRatings.nextAfter,
        olderPageAfter: olderRatings.nextAfter,
        fetchedOlder: Boolean(olderRatingsAfter),
      }),
      ratingreplies: nextGraphRepliesCursor({
        stored: cursor.ratingreplies,
        nestedAfters: { ...latestRatings.repliesAfter, ...olderRatings.repliesAfter },
        fetchedNextAfters: extraRatingReplies.nextAfters,
        fetchedIds: extraRatingReplies.fetchedIds,
      }),
      replies: nextGraphRepliesCursor({
        stored: cursor.replies,
        nestedAfters: { ...latestComments.repliesAfter, ...olderComments.repliesAfter },
        fetchedNextAfters: extraReplies.nextAfters,
        fetchedIds: extraReplies.fetchedIds,
      }),
      reviews:
        laterTimestampString(
          cursor.reviews,
          newestReceivedAt([...latestRatings.messages, ...olderRatings.messages]),
        ) ?? "",
      creplies: nextGraphRepliesCursor({
        stored: cursor.creplies,
        nestedAfters: {
          ...latestComments.crepliesAfter,
          ...olderComments.crepliesAfter,
          ...extraReplies.crepliesAfter,
          ...latestTagged.crepliesAfter,
          ...olderTagged.crepliesAfter,
          ...extraTaggedReplies.crepliesAfter,
          ...latestRatings.crepliesAfter,
          ...olderRatings.crepliesAfter,
          ...extraRatingReplies.crepliesAfter,
        },
        fetchedNextAfters: extraCreplies.nextAfters,
        fetchedIds: extraCreplies.fetchedIds,
      }),
      mentions:
        laterTimestampString(
          cursor.mentions,
          newestReceivedAt([...latestTagged.messages, ...olderTagged.messages]),
        ) ?? "",
      tagged: nextGraphAfterCursor({
        stored: cursor.tagged,
        firstPageAfter: latestTagged.nextAfter,
        olderPageAfter: olderTagged.nextAfter,
        fetchedOlder: Boolean(olderTaggedAfter),
      }),
      taggedreplies: nextGraphRepliesCursor({
        stored: cursor.taggedreplies,
        nestedAfters: { ...latestTagged.repliesAfter, ...olderTagged.repliesAfter },
        fetchedNextAfters: extraTaggedReplies.nextAfters,
        fetchedIds: extraTaggedReplies.fetchedIds,
      }),
      threadmsgs: nextGraphRepliesCursor({
        stored: cursor.threadmsgs,
        nestedAfters: {
          ...latestDirect.threadAfters,
          ...olderDirect.threadAfters,
          ...latestOther.threadAfters,
          ...olderOther.threadAfters,
          ...latestDone.threadAfters,
          ...olderDone.threadAfters,
          ...latestPending.threadAfters,
          ...olderPending.threadAfters,
        },
        fetchedNextAfters: extraThreadMsgs.nextAfters,
        fetchedIds: extraThreadMsgs.fetchedIds,
      }),
      threads: nextGraphAfterCursor({
        stored: cursor.threads,
        firstPageAfter: latestDirect.nextAfter,
        olderPageAfter: olderDirect.nextAfter,
        fetchedOlder: Boolean(olderThreadAfter),
      }),
    }),
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

