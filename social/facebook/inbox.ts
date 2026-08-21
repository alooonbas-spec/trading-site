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

async function collectFacebookMessenger(
  page: FacebookPageAuth,
  after?: string | null,
): Promise<{ messages: InboxMessage[]; nextAfter: string | null; threadAfters: GraphRepliesMap }> {
  const url = new URL(`${FACEBOOK_GRAPH_ORIGIN}/${page.id}/conversations`);
  url.searchParams.set("platform", "MESSENGER");
  url.searchParams.set("fields", "id,messages.limit(20){id,message,from,created_time}");
  url.searchParams.set("limit", "15");
  url.searchParams.set("access_token", page.accessToken);
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

export async function collectFacebookInbox(
  userAccessToken: string,
  metadata: Record<string, unknown> | undefined,
  input: InboxInput,
): Promise<InboxResult> {
  const page = await resolveFacebookPage(userAccessToken, metadata);
  const cursor = parseNamedInboxCursor(input.cursor);
  const olderThreadAfter = decodeGraphAfter(cursor.threads);
  const olderPostsAfter = decodeGraphAfter(cursor.posts);
  const storedReplies = decodeGraphReplies(cursor.replies);
  const storedCreplies = decodeGraphReplies(cursor.creplies);
  const storedThreadMsgs = decodeGraphReplies(cursor.threadmsgs);
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
  const [latestComments, olderComments, extraReplies, extraCreplies, latestDirect, olderDirect, extraThreadMsgs] =
    await Promise.all([
      collectFacebookComments(page),
      olderPostsAfter ? collectFacebookComments(page, olderPostsAfter) : Promise.resolve(emptyPage),
      storedReplies ? collectFacebookCommentReplies(page, storedReplies) : Promise.resolve(emptyReplies),
      storedCreplies ? collectFacebookNestedCommentReplies(page, storedCreplies) : Promise.resolve(emptyNested),
      collectFacebookMessenger(page),
      olderThreadAfter ? collectFacebookMessenger(page, olderThreadAfter) : Promise.resolve(emptyDirect),
      storedThreadMsgs
        ? collectFacebookThreadMessages(page, storedThreadMsgs)
        : Promise.resolve(emptyNested),
    ]);
  const comments = uniqueInboxMessages([
    ...filterMessagesAfterCursor(latestComments.messages, cursor.comments),
    ...olderComments.messages,
    ...extraReplies.messages,
    ...extraCreplies.messages,
  ]);
  const latestMessages = latestDirect.messages;
  const olderMessages = olderDirect.messages;
  return {
    messages: [
      ...comments,
      ...uniqueInboxMessages([
        ...filterMessagesAfterCursor(latestMessages, cursor.messages),
        ...olderMessages,
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
          ]),
        ) ?? "",
      messages:
        laterTimestampString(
          cursor.messages,
          newestReceivedAt([...latestMessages, ...olderMessages, ...extraThreadMsgs.messages]),
        ) ?? "",
      posts: nextGraphAfterCursor({
        stored: cursor.posts,
        firstPageAfter: latestComments.nextAfter,
        olderPageAfter: olderComments.nextAfter,
        fetchedOlder: Boolean(olderPostsAfter),
      }),
      replies: nextGraphRepliesCursor({
        stored: cursor.replies,
        nestedAfters: { ...latestComments.repliesAfter, ...olderComments.repliesAfter },
        fetchedNextAfters: extraReplies.nextAfters,
        fetchedIds: extraReplies.fetchedIds,
      }),
      creplies: nextGraphRepliesCursor({
        stored: cursor.creplies,
        nestedAfters: {
          ...latestComments.crepliesAfter,
          ...olderComments.crepliesAfter,
          ...extraReplies.crepliesAfter,
        },
        fetchedNextAfters: extraCreplies.nextAfters,
        fetchedIds: extraCreplies.fetchedIds,
      }),
      threadmsgs: nextGraphRepliesCursor({
        stored: cursor.threadmsgs,
        nestedAfters: { ...latestDirect.threadAfters, ...olderDirect.threadAfters },
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

