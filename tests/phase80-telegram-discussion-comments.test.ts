import { afterEach, describe, expect, it, vi } from "vitest";
import { UnsupportedActionError } from "@/lib/errors";
import { TelegramAdapter } from "@/social/telegram/adapter";
import { isTelegramDiscussionComment, parseTelegramUpdates } from "@/social/telegram/updates";

describe("PHASE 80 Telegram discussion-group comments", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("isTelegramDiscussionComment requires a supergroup reply to the automatic channel-post forward", () => {
    expect(isTelegramDiscussionComment("supergroup", { is_automatic_forward: true })).toBe(true);
    expect(isTelegramDiscussionComment("supergroup", { is_automatic_forward: false })).toBe(false);
    expect(isTelegramDiscussionComment("supergroup", undefined)).toBe(false);
    expect(isTelegramDiscussionComment("private", { is_automatic_forward: true })).toBe(false);
    expect(isTelegramDiscussionComment(undefined, { is_automatic_forward: true })).toBe(false);
  });

  it("collects a reply to the automatic forward as a comment, not a plain group message", () => {
    const payload = {
      ok: true,
      result: [
        {
          update_id: 30,
          message: {
            message_id: 5,
            text: "Nice post!",
            from: { id: 900, username: "commenter" },
            chat: { id: -100, username: "hub_discuss", type: "supergroup" },
            reply_to_message: { is_automatic_forward: true },
          },
        },
        {
          update_id: 31,
          message: {
            message_id: 6,
            text: "off-topic group chatter",
            from: { id: 901, username: "other" },
            chat: { id: -100, username: "hub_discuss", type: "supergroup" },
          },
        },
        {
          update_id: 32,
          message: {
            message_id: 7,
            text: "reply to another comment, not the forward itself",
            from: { id: 902, username: "third" },
            chat: { id: -100, username: "hub_discuss", type: "supergroup" },
            reply_to_message: { is_automatic_forward: false },
          },
        },
      ],
    };

    const parsed = parseTelegramUpdates(payload, "30");
    expect(parsed.inboxMessages).toEqual([
      {
        externalId: "30",
        externalProfileId: "900",
        username: "@commenter",
        body: "Nice post!",
        url: "https://t.me/hub_discuss/5",
        receivedAt: expect.any(String),
        replyKind: "comment",
      },
    ]);
    expect(parsed.cursor).toBe("33");
  });

  it("does not collect the automatic channel-post forward copy itself as a comment", () => {
    const payload = {
      ok: true,
      result: [
        {
          update_id: 40,
          message: {
            message_id: 8,
            text: "Original channel post text",
            chat: { id: -100, username: "hub_discuss", type: "supergroup" },
          },
        },
      ],
    };

    const parsed = parseTelegramUpdates(payload, "40");
    expect(parsed.inboxMessages).toEqual([]);
  });

  it("still refuses to reply to a comment, the same as any non-DM kind", async () => {
    await expect(
      new TelegramAdapter({ accessToken: "123456:ABC-token_value" }).replyToInbox({
        workspaceId: "w",
        socialAccountId: "a",
        kind: "comment",
        body: "Thanks!",
        externalEventId: "30",
        target: { externalProfileId: "900", username: "@commenter" },
      }),
    ).rejects.toBeInstanceOf(UnsupportedActionError);
  });

  it("collects a discussion comment through the adapter's shared collectInbox path", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          result: [
            {
              update_id: 50,
              message: {
                message_id: 9,
                text: "Great update",
                from: { id: 910, username: "fan" },
                chat: { id: -100, username: "hub_discuss", type: "supergroup" },
                reply_to_message: { is_automatic_forward: true },
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new TelegramAdapter({ accessToken: "123456:ABC-token_value" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
    });
    expect(result.messages).toEqual([
      {
        externalId: "50",
        externalProfileId: "910",
        username: "@fan",
        body: "Great update",
        url: "https://t.me/hub_discuss/9",
        receivedAt: expect.any(String),
        replyKind: "comment",
      },
    ]);
  });
});
