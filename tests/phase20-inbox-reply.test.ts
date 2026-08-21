import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthenticationError, UnsupportedActionError, ValidationError } from "@/lib/errors";
import {
  inferInboxReplyKind,
  isInboxReplyKind,
  resolveInboxReplyKind,
} from "@/lib/inbox/reply-kind";
import { replyInboxEventSchema } from "@/lib/validation/lead";
import { DISABLED_CAPABILITIES } from "@/social/core/base-adapter";
import { getSocialAdapter } from "@/social/core/registry";
import { FACEBOOK_GRAPH_ORIGIN, FACEBOOK_SCOPES } from "@/social/facebook/graph";
import { FacebookAdapter } from "@/social/facebook/adapter";
import { facebookCommentReplyUrl } from "@/social/facebook/inbox";
import { InstagramAdapter } from "@/social/instagram/adapter";
import { instagramCommentReplyUrl } from "@/social/instagram/inbox";
import { TelegramAdapter, telegramMethodUrl } from "@/social/telegram/adapter";
import { VkAdapter } from "@/social/vk/adapter";
import { parseVkInboxCommentRef } from "@/social/vk/inbox";
import { vkMethodUrl } from "@/social/vk/api";
import { XAdapter } from "@/social/x/adapter";
import { xMentionReplyUrl } from "@/social/x/inbox";
import { ACTIVITY_ACTIONS } from "@/types/activity";
import { INTERACTION_TYPES } from "@/types/crm";
import { SOCIAL_PLATFORMS } from "@/types/social";

describe("PHASE 20 inbox reply kinds", () => {
  it("stores official kinds and infers pre-PHASE-20 rows from platform and URL", () => {
    expect(isInboxReplyKind("direct_message")).toBe(true);
    expect(isInboxReplyKind("comment")).toBe(true);
    expect(isInboxReplyKind("mention")).toBe(true);
    expect(isInboxReplyKind("dm")).toBe(false);
    expect(inferInboxReplyKind("telegram", "https://t.me/lead/3")).toBe("direct_message");
    expect(inferInboxReplyKind("vk", "https://vk.com/wall1_2?reply=3")).toBe("comment");
    expect(inferInboxReplyKind("x", "https://x.com/lead/status/99")).toBe("mention");
    expect(inferInboxReplyKind("x", null)).toBe("direct_message");
    expect(inferInboxReplyKind("facebook", "https://www.facebook.com/123_456")).toBe("comment");
    expect(inferInboxReplyKind("facebook", null)).toBe("direct_message");
    expect(inferInboxReplyKind("instagram", "https://www.instagram.com/p/media-1/")).toBe("comment");
    expect(inferInboxReplyKind("instagram", null)).toBe("direct_message");
    expect(
      resolveInboxReplyKind({
        stored: "mention",
        platform: "x",
        url: null,
      }),
    ).toBe("mention");
  });

  it("parses VK wall comment refs and refuses incomplete ids", () => {
    expect(parseVkInboxCommentRef("10:20:30")).toEqual({
      ownerId: "10",
      postId: "20",
      commentId: "30",
    });
    expect(parseVkInboxCommentRef("-100:9:4")).toEqual({
      ownerId: "-100",
      postId: "9",
      commentId: "4",
    });
    expect(() => parseVkInboxCommentRef(":9:4")).toThrow(ValidationError);
    expect(() => parseVkInboxCommentRef("owner:post:comment")).toThrow(ValidationError);
  });
});

describe("PHASE 20 official replies", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends Telegram Direct Message replies through sendMessage", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(String(url)).toBe(telegramMethodUrl("123456:ABC-token_value", "sendMessage"));
      return new Response(
        JSON.stringify({
          ok: true,
          result: { message_id: 44, chat: { id: 77, username: "lead_user" } },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const sent = await new TelegramAdapter({ accessToken: "123456:ABC-token_value" }).replyToInbox({
      workspaceId: "w",
      socialAccountId: "a",
      kind: "direct_message",
      body: "Thanks for writing in",
      externalEventId: "15",
      target: { externalProfileId: "77", username: "@lead_user" },
    });
    expect(sent.externalMessageId).toBe("77:44");

    await expect(
      new TelegramAdapter({ accessToken: "123456:ABC-token_value" }).replyToInbox({
        workspaceId: "w",
        socialAccountId: "a",
        kind: "comment",
        body: "nope",
        externalEventId: "15",
        target: { externalProfileId: "77", username: null },
      }),
    ).rejects.toBeInstanceOf(UnsupportedActionError);
  });

  it("replies to X mentions through tweets and DMs through dm_conversations", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe(xMentionReplyUrl());
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        text: "Saw your mention",
        reply: { in_reply_to_tweet_id: "tweet-1" },
      });
      return new Response(JSON.stringify({ data: { id: "tweet-2" } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new XAdapter({ accessToken: "x-token" });
    const mention = await adapter.replyToInbox({
      workspaceId: "w",
      socialAccountId: "a",
      kind: "mention",
      body: "Saw your mention",
      externalEventId: "tweet-1",
      target: { externalProfileId: "200", username: "@lead" },
    });
    expect(mention.externalMessageId).toBe("tweet-2");

    await expect(
      adapter.replyToInbox({
        workspaceId: "w",
        socialAccountId: "a",
        kind: "comment",
        body: "nope",
        externalEventId: "tweet-1",
        target: { externalProfileId: "200", username: "@lead" },
      }),
    ).rejects.toBeInstanceOf(UnsupportedActionError);

    await expect(new XAdapter().replyToInbox({
      workspaceId: "w",
      socialAccountId: "a",
      kind: "mention",
      body: "Hi",
      externalEventId: "tweet-1",
      target: { externalProfileId: "200", username: "@lead" },
    })).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("replies to Facebook comments through Page comment replies", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      if (target.startsWith(`${FACEBOOK_GRAPH_ORIGIN}/me/accounts`)) {
        return new Response(
          JSON.stringify({ data: [{ id: "555", name: "Hub Page", access_token: "page-token" }] }),
          { status: 200 },
        );
      }
      expect(target.startsWith(facebookCommentReplyUrl("c1"))).toBe(true);
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ message: "Thanks for the comment" });
      return new Response(JSON.stringify({ id: "c1_reply" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const sent = await new FacebookAdapter({ accessToken: "user-token" }).replyToInbox({
      workspaceId: "w",
      socialAccountId: "a",
      kind: "comment",
      body: "Thanks for the comment",
      externalEventId: "c1",
      target: { externalProfileId: "800", username: "Commenter" },
    });
    expect(sent.externalMessageId).toBe("c1_reply");
    expect(FACEBOOK_SCOPES).toContain("pages_manage_engagement");
  });

  it("replies to Instagram comments through official comment replies", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url).startsWith(instagramCommentReplyUrl("c1"))).toBe(true);
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ message: "Thanks" });
      return new Response(JSON.stringify({ id: "reply-9" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const sent = await new InstagramAdapter({
      accessToken: "ig-token",
      metadata: { instagramUserId: "ig-1" },
    }).replyToInbox({
      workspaceId: "w",
      socialAccountId: "a",
      kind: "comment",
      body: "Thanks",
      externalEventId: "c1",
      target: { externalProfileId: "80", username: "@fan" },
    });
    expect(sent.externalMessageId).toBe("reply-9");
  });

  it("replies to VK wall comments through wall.createComment", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe(vkMethodUrl("wall.createComment"));
      expect(String(init?.body)).toContain("owner_id=10");
      expect(String(init?.body)).toContain("post_id=20");
      expect(String(init?.body)).toContain("reply_to_comment=30");
      expect(String(init?.body)).toContain("message=Thanks");
      return new Response(JSON.stringify({ response: { comment_id: 99 } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const sent = await new VkAdapter({ accessToken: "vk-token" }).replyToInbox({
      workspaceId: "w",
      socialAccountId: "a",
      kind: "comment",
      body: "Thanks",
      externalEventId: "10:20:30",
      target: { externalProfileId: "42", username: null },
    });
    expect(sent.externalMessageId).toBe("99");

    await expect(
      new VkAdapter({ accessToken: "vk-token" }).replyToInbox({
        workspaceId: "w",
        socialAccountId: "a",
        kind: "direct_message",
        body: "Hi",
        externalEventId: "10:20:30",
        target: { externalProfileId: "42", username: null },
      }),
    ).rejects.toBeInstanceOf(UnsupportedActionError);
  });
});

describe("PHASE 20 capabilities and source boundaries", () => {
  it("enables inboxReply on official inbox adapters and keeps the default off", async () => {
    expect(DISABLED_CAPABILITIES.inboxReply).toBe(false);
    for (const platform of SOCIAL_PLATFORMS) {
      expect((await getSocialAdapter(platform).getCapabilities()).inboxReply).toBe(true);
    }
  });

  it("validates reply payloads and records MESSAGE plus INBOX_REPLIED", () => {
    expect(INTERACTION_TYPES).toContain("MESSAGE");
    expect(ACTIVITY_ACTIONS).toContain("INBOX_REPLIED");
    expect(replyInboxEventSchema.safeParse({ inboxEventId: "not-a-uuid", body: "hi" }).success).toBe(false);
    expect(
      replyInboxEventSchema.safeParse({
        inboxEventId: "11111111-1111-4111-8111-111111111111",
        body: "Thanks for writing in",
      }).success,
    ).toBe(true);
    expect(
      replyInboxEventSchema.safeParse({
        inboxEventId: "11111111-1111-4111-8111-111111111111",
        body: "   ",
      }).success,
    ).toBe(false);
  });

  it("keeps replies on adapters and does not add do_not_contact to inbox_events", () => {
    const sql = readFileSync("supabase/migrations/20260821300000_phase20_inbox_reply.sql", "utf8");
    const withoutComments = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(sql).toContain("alter type public.interaction_type add value 'MESSAGE'");
    expect(sql).toContain("reply_kind");
    expect(withoutComments).not.toMatch(/do_not_contact boolean/);

    const service = readFileSync("services/inbox/reply-service.ts", "utf8");
    expect(service).toContain("adapter.replyToInbox");
    expect(service).toContain("assertCanContactLead");
    expect(service).toContain("takeAccountAdapterRate");
    expect(service).toContain("prepareAccountAdapter");
    expect(service).not.toMatch(/if\s*\(\s*platform\s*===/);
    expect(service).toContain('type: "MESSAGE"');
    expect(service).toContain("INBOX_REPLIED");
    expect(service).toContain('"REPLIED"');
    expect(service).toContain('"BLOCKED"');

    const worker = readFileSync("services/jobs/worker-service.ts", "utf8");
    expect(worker).toContain("takeAccountAdapterRate");
    expect(worker).not.toMatch(/if\s*\(\s*platform\s*===/);

    const page = readFileSync("app/(dashboard)/w/[workspaceId]/inbox/page.tsx", "utf8");
    expect(page).toContain("ReplyInboxForm");
    expect(page).toContain("never creates people automatically");
  });
});
