import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inboxMessageMatchesProfile, normalizeInboxIdentity } from "@/lib/inbox/match-profile";
import { getSocialAdapter } from "@/social/core/registry";
import { TelegramAdapter, telegramMethodUrl } from "@/social/telegram/adapter";
import { parseTelegramInboxUpdates } from "@/social/telegram/inbox";
import { XAdapter } from "@/social/x/adapter";
import { JOB_TYPES } from "@/types/campaign";
import { INTERACTION_TYPES } from "@/types/crm";

describe("inbox identity matching", () => {
  it("matches CRM profiles by numeric id or username", () => {
    expect(normalizeInboxIdentity("@LeadUser")).toBe("leaduser");
    expect(
      inboxMessageMatchesProfile(
        {
          externalId: "1",
          externalProfileId: "42",
          username: "@leaduser",
          body: "Hi",
          url: null,
          receivedAt: null,
        },
        { externalProfileId: "leaduser", username: "@LeadUser" },
      ),
    ).toBe(true);
    expect(
      inboxMessageMatchesProfile(
        {
          externalId: "1",
          externalProfileId: "42",
          username: null,
          body: "Hi",
          url: null,
          receivedAt: null,
        },
        { externalProfileId: "42", username: null },
      ),
    ).toBe(true);
    expect(
      inboxMessageMatchesProfile(
        {
          externalId: "1",
          externalProfileId: "99",
          username: "@other",
          body: "Hi",
          url: null,
          receivedAt: null,
        },
        { externalProfileId: "leaduser", username: "@LeadUser" },
      ),
    ).toBe(false);
  });
});

describe("Telegram inbox", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses private messages and skips bots", () => {
    const parsed = parseTelegramInboxUpdates({
      ok: true,
      result: [
        {
          update_id: 15,
          message: {
            message_id: 3,
            text: "I am interested",
            from: { id: 77, username: "lead_user" },
            chat: { id: 77, username: "lead_user", type: "private" },
          },
        },
        {
          update_id: 16,
          message: {
            message_id: 4,
            text: "bot noise",
            from: { id: 1, is_bot: true, username: "hub_bot" },
          },
        },
      ],
    });
    expect(parsed.cursor).toBe("17");
    expect(parsed.messages).toEqual([
      {
        externalId: "15",
        externalProfileId: "77",
        username: "@lead_user",
        body: "I am interested",
        url: "https://t.me/lead_user/3",
        receivedAt: expect.any(String),
        replyKind: "direct_message",
      },
    ]);
  });

  it("collects inbox through official getUpdates", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(String(url)).toContain(telegramMethodUrl("123456:ABC-token_value", "getUpdates"));
      return new Response(
        JSON.stringify({
          ok: true,
          result: [
            {
              update_id: 8,
              message: {
                message_id: 1,
                text: "Reply from lead",
                from: { id: 9, username: "lead" },
              },
            },
          ],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new TelegramAdapter({ accessToken: "123456:ABC-token_value" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
    });
    expect(result.messages[0]?.body).toBe("Reply from lead");
    expect(result.cursor).toBe("9");
  });
});

describe("X inbox", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads mentions through the official users/:id/mentions endpoint", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.startsWith("https://api.x.com/2/users/me")) {
        return new Response(JSON.stringify({ data: { id: "100", username: "hub" } }), { status: 200 });
      }
      if (target.includes("https://api.x.com/2/users/100/mentions")) {
        return new Response(
          JSON.stringify({
            data: [{ id: "tweet-1", text: "@hub hello", author_id: "200" }],
            includes: { users: [{ id: "200", username: "lead" }] },
            meta: { newest_id: "tweet-1" },
          }),
          { status: 200 },
        );
      }
      if (target.includes("/quote_tweets") || /\/2\/users\/[^/]+\/tweets(?:\?|$)/.test(target)) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      expect(target).toContain("https://api.x.com/2/dm_events");
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new XAdapter({ accessToken: "x-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
    });
    expect(result.messages[0]).toMatchObject({
      externalId: "tweet-1",
      externalProfileId: "200",
      username: "@lead",
      body: "@hub hello",
    });
  });
});

describe("PHASE 13 capabilities and source boundaries", () => {
  it("enables inbox collection and Meta contact while VK contact stays off", async () => {
    expect((await getSocialAdapter("telegram").getCapabilities()).inbox).toBe(true);
    expect((await getSocialAdapter("x").getCapabilities()).inbox).toBe(true);
    expect((await getSocialAdapter("facebook").getCapabilities()).inbox).toBe(true);
    expect((await getSocialAdapter("instagram").getCapabilities()).inbox).toBe(true);
    expect((await getSocialAdapter("vk").getCapabilities()).inbox).toBe(true);
    expect((await getSocialAdapter("vk").getCapabilities()).contactActions).toBe(false);
    expect((await getSocialAdapter("facebook").getCapabilities()).contactActions).toBe(true);
    expect((await getSocialAdapter("instagram").getCapabilities()).contactActions).toBe(true);
  });

  it("adds INBOX jobs and REPLY interactions without do_not_contact on inbox tables", () => {
    expect(JOB_TYPES).toContain("INBOX");
    expect(INTERACTION_TYPES).toContain("REPLY");
    const sql = readFileSync("supabase/migrations/20260821260000_phase13_inbox.sql", "utf8");
    const withoutComments = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(withoutComments).not.toMatch(/do_not_contact boolean/);
    expect(sql).toContain("type = 'INBOX'");
    expect(sql).toContain("unique (workspace_id, social_account_id, external_id)");
    const worker = readFileSync("services/jobs/worker-service.ts", "utf8");
    expect(worker).not.toMatch(/if\s*\(\s*platform\s*===/);
    expect(worker).toContain('job.type === "INBOX"');
    expect(worker).toContain("adapter.collectInbox");
    expect(worker).toContain("ingestInboxMessages");
  });
});
