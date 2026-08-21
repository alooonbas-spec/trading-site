import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UnsupportedActionError, ValidationError } from "@/lib/errors";
import {
  accountSupportsCampaignAction,
  platformsSupportingCampaignAction,
  unsupportedCampaignActionMessage,
} from "@/lib/campaigns/contact-capabilities";
import { getSocialAdapter } from "@/social/core/registry";
import { VkAdapter } from "@/social/vk/adapter";
import { vkMethodUrl } from "@/social/vk/api";
import {
  connectVkCommunity,
  isVkCommunityAccount,
  normalizeVkGroupRef,
  vkCommunityMetadata,
} from "@/social/vk/community";
import { parseVkCommunityConversations, parseVkInboxCursor } from "@/social/vk/inbox";
import { vkCommunityPeerId } from "@/social/vk/contact";

const communityMetadata = vkCommunityMetadata("12345");

describe("VK community identity", () => {
  it("normalizes community refs and stores kind in metadata, not the token", () => {
    expect(normalizeVkGroupRef("https://vk.com/club12345")).toBe("12345");
    expect(normalizeVkGroupRef("-12345")).toBe("12345");
    expect(normalizeVkGroupRef("hub.group")).toBe("hub.group");
    expect(() => normalizeVkGroupRef("")).toThrow(ValidationError);
    expect(isVkCommunityAccount(communityMetadata)).toBe(true);
    expect(isVkCommunityAccount({})).toBe(false);
    expect(JSON.stringify(communityMetadata)).not.toContain("access_token");
  });
});

describe("PHASE 23 VK community conversations", () => {
  it("parses inbound last messages and skips outbound or chat peers", () => {
    const messages = parseVkCommunityConversations(
      {
        items: [
          {
            conversation: { peer: { id: 42, type: "user" } },
            last_message: { id: 9, from_id: 42, text: "hello club", date: 1710000099, out: 0 },
          },
          {
            conversation: { peer: { id: 42, type: "user" } },
            last_message: { id: 8, from_id: -12345, text: "we replied", date: 1710000098, out: 1 },
          },
          {
            conversation: { peer: { id: 2000000001, type: "chat" } },
            last_message: { id: 7, from_id: 99, text: "group chat", date: 1710000097 },
          },
        ],
        profiles: [{ id: 42, screen_name: "lead" }],
      },
      "12345",
    );
    expect(messages).toEqual([
      {
        externalId: "9",
        externalProfileId: "42",
        username: "@lead",
        body: "hello club",
        url: null,
        receivedAt: "2024-03-09T16:01:39.000Z",
        replyKind: "direct_message",
      },
    ]);
    expect(parseVkInboxCursor("1710000000")).toEqual({
      comments: "1710000000",
      messages: null,
      history: false,
      historyPage: 0,
      conversations: false,
      conversationsPage: 0,
      wall: false,
      wallPage: 0,
      wallcomments: false,
      wallcommentsPage: 0,
    });
    expect(parseVkInboxCursor("comments:1710000000|messages:8")).toEqual({
      comments: "1710000000",
      messages: "8",
      history: false,
      historyPage: 0,
      conversations: false,
      conversationsPage: 0,
      wall: false,
      wallPage: 0,
      wallcomments: false,
      wallcommentsPage: 0,
    });
    expect(parseVkInboxCursor("comments:1710000000|history:1|messages:8")).toEqual({
      comments: "1710000000",
      messages: "8",
      history: true,
      historyPage: 1,
      conversations: false,
      conversationsPage: 0,
      wall: false,
      wallPage: 0,
      wallcomments: false,
      wallcommentsPage: 0,
    });
    expect(vkCommunityPeerId({ externalProfileId: "42", username: "@lead" })).toBe("42");
    expect(vkCommunityPeerId({ externalProfileId: "lead", username: "@lead" })).toBeNull();
  });
});

describe("PHASE 23 VK community adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("connects through groups.getById and encrypts a community token, not metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        expect(String(url)).toBe(vkMethodUrl("groups.getById"));
        expect(String(init?.body)).toContain("group_id=12345");
        expect(String(init?.body)).toContain("access_token=community-token-value");
        return new Response(
          JSON.stringify({
            response: {
              groups: [{ id: 12345, name: "Hub Club", screen_name: "hubclub", photo_200: "https://vk.com/p.png" }],
            },
          }),
          { status: 200 },
        );
      }),
    );

    const connected = await connectVkCommunity({
      token: "community-token-value",
      groupRef: "club12345",
    });
    expect(connected.externalAccountId).toBe("12345");
    expect(connected.username).toBe("hubclub");
    expect(connected.displayName).toBe("Hub Club");
    expect(connected.refreshToken).toBeNull();
    expect(connected.tokenExpiresAt).toBeNull();
    expect(connected.scopes).toEqual(["community", "messages"]);
    expect(connected.metadata).toEqual(communityMetadata);
    expect(JSON.stringify(connected.metadata)).not.toContain("community-token-value");
  });

  it("collects wall comments and community DMs with independent cursors", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target === vkMethodUrl("wall.get")) {
        return new Response(JSON.stringify({ response: { items: [{ id: 20, owner_id: -12345 }] } }), {
          status: 200,
        });
      }
      if (target === vkMethodUrl("wall.getComments")) {
        return new Response(
          JSON.stringify({
            response: {
              items: [
                { id: 1, from_id: 42, text: "old comment", date: 1710000000 },
                { id: 2, from_id: 42, text: "new comment", date: 1710000099 },
              ],
            },
          }),
          { status: 200 },
        );
      }
      if (target === vkMethodUrl("messages.getConversations")) {
        return new Response(
          JSON.stringify({
            response: {
              items: [
                {
                  conversation: { peer: { id: 42, type: "user" } },
                  last_message: { id: 8, from_id: 42, text: "old dm", date: 1710000001, out: 0 },
                },
                {
                  conversation: { peer: { id: 42, type: "user" } },
                  last_message: { id: 11, from_id: 42, text: "new dm", date: 1710000098, out: 0 },
                },
              ],
              profiles: [{ id: 42, screen_name: "lead" }],
            },
          }),
          { status: 200 },
        );
      }
      expect(target).toBe(vkMethodUrl("messages.getHistory"));
      return new Response(
        JSON.stringify({
          response: {
            items: [
              { id: 8, from_id: 42, text: "old dm", date: 1710000001, out: 0, peer_id: 42 },
              { id: 9, from_id: 42, text: "missed dm", date: 1710000002, out: 0, peer_id: 42 },
              { id: 10, from_id: -12345, text: "we replied", date: 1710000003, out: 1, peer_id: 42 },
              { id: 11, from_id: 42, text: "new dm", date: 1710000098, out: 0, peer_id: 42 },
            ],
            profiles: [{ id: 42, screen_name: "lead" }],
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new VkAdapter({
      accessToken: "community-token",
      metadata: communityMetadata,
    }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: "comments:1710000000|messages:8",
    });
    expect(result.messages.map((item) => item.externalId).sort()).toEqual(["-12345:20:2", "11", "8", "9"]);
    expect(result.cursor).toBe("comments:1710000099|conversations:1|history:1|messages:11|wall:1|wallcomments:1");
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("messages.getHistory"))).toHaveLength(1);
  });

  it("sends community DMs through messages.send and still refuses user OAuth DMs", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe(vkMethodUrl("messages.send"));
      expect(String(init?.body)).toContain("peer_id=42");
      expect(String(init?.body)).toContain("message=Hello");
      expect(String(init?.body)).toContain("random_id=");
      return new Response(JSON.stringify({ response: 77 }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const community = new VkAdapter({ accessToken: "community-token", metadata: communityMetadata });
    const sent = await community.executeContactAction({
      workspaceId: "w",
      socialAccountId: "a",
      socialProfileId: "p",
      leadId: "l",
      action: "MESSAGE",
      body: "Hello",
      target: { externalProfileId: "42", username: "@lead" },
    });
    expect(sent).toEqual({ status: "SUCCESS", externalMessageId: "77" });

    const replied = await community.replyToInbox({
      workspaceId: "w",
      socialAccountId: "a",
      kind: "direct_message",
      body: "Hello",
      externalEventId: "11",
      target: { externalProfileId: "42", username: "@lead" },
    });
    expect(replied.externalMessageId).toBe("77");

    await expect(
      new VkAdapter({ accessToken: "user-token" }).executeContactAction({
        workspaceId: "w",
        socialAccountId: "a",
        socialProfileId: "p",
        leadId: "l",
        action: "MESSAGE",
        body: "Hello",
        target: { externalProfileId: "42", username: null },
      }),
    ).rejects.toBeInstanceOf(UnsupportedActionError);

    await expect(
      community.executeContactAction({
        workspaceId: "w",
        socialAccountId: "a",
        socialProfileId: "p",
        leadId: "l",
        action: "INVITE",
      }),
    ).rejects.toBeInstanceOf(UnsupportedActionError);
  });
});

describe("PHASE 23 campaign gating", () => {
  it("enables MESSAGE only for VK community metadata and keeps user OAuth off", async () => {
    expect((await getSocialAdapter("vk").getCapabilities()).messaging).toBe(false);
    expect((await getSocialAdapter("vk").getCapabilities()).contactActions).toBe(false);
    expect((await getSocialAdapter("vk").getCapabilities()).invites).toBe(false);
    expect(
      await accountSupportsCampaignAction({
        platform: "vk",
        action: "MESSAGE",
      }),
    ).toBe(false);
    expect(
      await accountSupportsCampaignAction({
        platform: "vk",
        metadata: communityMetadata,
        action: "MESSAGE",
      }),
    ).toBe(true);
    expect(
      await accountSupportsCampaignAction({
        platform: "vk",
        metadata: communityMetadata,
        action: "INVITE",
      }),
    ).toBe(false);
    expect((await platformsSupportingCampaignAction(["vk"], "MESSAGE")).size).toBe(0);
    expect(unsupportedCampaignActionMessage("MESSAGE")).toContain("VK community token");
  });

  it("gates enqueue per account metadata and keeps community tokens off the client", () => {
    const enqueue = readFileSync("services/jobs/enqueue-service.ts", "utf8");
    const adapter = readFileSync("social/vk/adapter.ts", "utf8");
    const mapper = readFileSync("services/social-accounts/mapper.ts", "utf8");
    const page = readFileSync("app/(dashboard)/w/[workspaceId]/social-accounts/page.tsx", "utf8");
    expect(enqueue).toContain("accountSupportsCampaignAction");
    expect(enqueue).toContain("asAccountMetadata");
    expect(enqueue).not.toMatch(/if\s*\(\s*platform\s*===/);
    expect(adapter).toContain("connectVkCommunity");
    expect(adapter).toContain("sendVkCommunityMessage");
    expect(readFileSync("social/vk/contact.ts", "utf8")).toContain("messages.send");
    expect(readFileSync("social/vk/inbox.ts", "utf8")).toContain("messages.getConversations");
    expect(readFileSync("social/vk/inbox.ts", "utf8")).toContain("messages.getHistory");
    expect(adapter).not.toContain("VK_COMMUNITY_TOKEN");
    expect(mapper).toContain("assertNoTokenLeak");
    expect(page).toContain("ConnectVkCommunityDialog");
    expect(readFileSync("components/social-accounts/connect-vk-community-dialog.tsx", "utf8")).toContain(
      "never sent back to the browser",
    );
  });
});
