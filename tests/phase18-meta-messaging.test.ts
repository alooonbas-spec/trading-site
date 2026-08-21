import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthenticationError, UnsupportedActionError, ValidationError } from "@/lib/errors";
import { FACEBOOK_GRAPH_ORIGIN, FACEBOOK_SCOPES } from "@/social/facebook/graph";
import { FacebookAdapter } from "@/social/facebook/adapter";
import { parseFacebookMessengerConversations } from "@/social/facebook/inbox";
import { facebookPageMessagesUrl } from "@/social/facebook/contact";
import { InstagramAdapter } from "@/social/instagram/adapter";
import { INSTAGRAM_SCOPES } from "@/social/instagram/publish";
import { parseInstagramDirectConversations } from "@/social/instagram/inbox";
import { instagramMessagesUrl } from "@/social/instagram/contact";
import { getSocialAdapter } from "@/social/core/registry";
import { platformsSupportingCampaignAction } from "@/lib/campaigns/contact-capabilities";

describe("PHASE 18 Facebook Messenger", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests pages_messaging and pages_manage_metadata", () => {
    expect(FACEBOOK_SCOPES).toContain("pages_messaging");
    expect(FACEBOOK_SCOPES).toContain("pages_manage_metadata");
  });

  it("parses inbound Messenger events and skips Page outbound or empty text", () => {
    const messages = parseFacebookMessengerConversations(
      {
        data: [
          {
            id: "t1",
            messages: {
              data: [
                { id: "m-out", message: "from page", from: { id: "555", name: "Hub Page" } },
                { id: "m-empty", from: { id: "900", name: "Lead" } },
                {
                  id: "m-in",
                  message: "hello page",
                  created_time: "2026-08-21T12:00:00+0000",
                  from: { id: "900", name: "Lead" },
                },
              ],
            },
          },
        ],
      },
      "555",
    );
    expect(messages).toEqual([
      {
        externalId: "m-in",
        externalProfileId: "900",
        username: "Lead",
        body: "hello page",
        url: null,
        receivedAt: "2026-08-21T12:00:00+0000",
        replyKind: "direct_message",
      },
    ]);
  });

  it("collects Page comments and Messenger threads together", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.startsWith(`${FACEBOOK_GRAPH_ORIGIN}/me/accounts`)) {
        return new Response(
          JSON.stringify({ data: [{ id: "555", name: "Hub Page", access_token: "page-token" }] }),
          { status: 200 },
        );
      }
      if (target.includes("/555/feed")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "555_1",
                comments: {
                  data: [
                    {
                      id: "c1",
                      message: "nice post",
                      from: { id: "800", name: "Commenter" },
                      created_time: "2026-08-21T11:00:00+0000",
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        );
      }
      expect(target).toContain("/555/conversations");
      expect(target).toContain("platform=MESSENGER");
      return new Response(
        JSON.stringify({
          data: [
            {
              messages: {
                data: [
                  {
                    id: "m1",
                    message: "private hello",
                    from: { id: "900", name: "Lead" },
                    created_time: "2026-08-21T12:00:00+0000",
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new FacebookAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
    });
    expect(result.messages).toEqual([
      expect.objectContaining({
        externalId: "c1",
        externalProfileId: "800",
        body: "nice post",
      }),
      {
        externalId: "m1",
        externalProfileId: "900",
        username: "Lead",
        body: "private hello",
        url: null,
        receivedAt: "2026-08-21T12:00:00+0000",
        replyKind: "direct_message",
      },
    ]);
  });

  it("sends MESSAGE through official Page messages and refuses INVITE", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      if (target.startsWith(`${FACEBOOK_GRAPH_ORIGIN}/me/accounts`)) {
        return new Response(
          JSON.stringify({ data: [{ id: "555", name: "Hub Page", access_token: "page-token" }] }),
          { status: 200 },
        );
      }
      expect(target.startsWith(facebookPageMessagesUrl("555"))).toBe(true);
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        recipient: { id: "900" },
        messaging_type: "RESPONSE",
        message: { text: "Hello lead" },
      });
      return new Response(JSON.stringify({ message_id: "mid.1", recipient_id: "900" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new FacebookAdapter({ accessToken: "user-token" });
    const sent = await adapter.executeContactAction({
      workspaceId: "w",
      socialAccountId: "a",
      socialProfileId: "p",
      leadId: "l",
      action: "MESSAGE",
      body: "Hello lead",
      target: { externalProfileId: "900", username: "Lead" },
    });
    expect(sent.status).toBe("SUCCESS");
    expect(sent.externalMessageId).toBe("mid.1");

    await expect(
      adapter.executeContactAction({
        workspaceId: "w",
        socialAccountId: "a",
        socialProfileId: "p",
        leadId: "l",
        action: "INVITE",
        target: { externalProfileId: "900", username: "Lead" },
      }),
    ).rejects.toBeInstanceOf(UnsupportedActionError);
  });

  it("fails Messenger MESSAGE honestly without a Page-scoped id", async () => {
    await expect(
      new FacebookAdapter({ accessToken: "user-token" }).executeContactAction({
        workspaceId: "w",
        socialAccountId: "a",
        socialProfileId: "p",
        leadId: "l",
        action: "MESSAGE",
        body: "Hi",
        target: { externalProfileId: "lead.user", username: "lead.user" },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("PHASE 18 Instagram Direct Messages", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests instagram_business_manage_messages", () => {
    expect(INSTAGRAM_SCOPES).toContain("instagram_business_manage_messages");
  });

  it("parses inbound DMs and skips own outbound events", () => {
    const messages = parseInstagramDirectConversations(
      {
        data: [
          {
            messages: {
              data: [
                { id: "out", message: "from us", from: { id: "ig-1", username: "hub" } },
                {
                  id: "in",
                  message: "hello creator",
                  created_time: "2026-08-21T09:00:00+0000",
                  from: { id: "700", username: "lead" },
                },
              ],
            },
          },
        ],
      },
      "ig-1",
    );
    expect(messages).toEqual([
      {
        externalId: "in",
        externalProfileId: "700",
        username: "@lead",
        body: "hello creator",
        url: null,
        receivedAt: "2026-08-21T09:00:00+0000",
        replyKind: "direct_message",
      },
    ]);
  });

  it("collects media comments and Direct Messages together", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.includes("/ig-1/media")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "media-1",
                comments: {
                  data: [{ id: "c1", text: "nice", from: { id: "80", username: "fan" } }],
                },
              },
            ],
          }),
          { status: 200 },
        );
      }
      expect(target).toContain("/ig-1/conversations");
      expect(target).toContain("platform=instagram");
      return new Response(
        JSON.stringify({
          data: [
            {
              messages: {
                data: [
                  {
                    id: "dm1",
                    message: "private hi",
                    from: { id: "700", username: "lead" },
                    created_time: "2026-08-21T09:00:00+0000",
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new InstagramAdapter({
      accessToken: "ig-token",
      metadata: { instagramUserId: "ig-1" },
    }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
    });
    expect(result.messages).toEqual([
      expect.objectContaining({
        externalId: "c1",
        externalProfileId: "80",
        body: "nice",
      }),
      {
        externalId: "dm1",
        externalProfileId: "700",
        username: "@lead",
        body: "private hi",
        url: null,
        receivedAt: "2026-08-21T09:00:00+0000",
        replyKind: "direct_message",
      },
    ]);
  });

  it("sends MESSAGE through official IG messages and refuses INVITE", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url).startsWith(instagramMessagesUrl("ig-1"))).toBe(true);
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        recipient: { id: "700" },
        message: { text: "Hello lead" },
      });
      return new Response(JSON.stringify({ message_id: "igmid.1" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new InstagramAdapter({
      accessToken: "ig-token",
      metadata: { instagramUserId: "ig-1" },
    });
    const sent = await adapter.executeContactAction({
      workspaceId: "w",
      socialAccountId: "a",
      socialProfileId: "p",
      leadId: "l",
      action: "MESSAGE",
      body: "Hello lead",
      target: { externalProfileId: "700", username: "@lead" },
    });
    expect(sent.status).toBe("SUCCESS");
    expect(sent.externalMessageId).toBe("igmid.1");

    await expect(
      adapter.executeContactAction({
        workspaceId: "w",
        socialAccountId: "a",
        socialProfileId: "p",
        leadId: "l",
        action: "INVITE",
        target: { externalProfileId: "700", username: "@lead" },
      }),
    ).rejects.toBeInstanceOf(UnsupportedActionError);
  });

  it("fails Instagram MESSAGE honestly without an Instagram-scoped id or token", async () => {
    await expect(
      new InstagramAdapter({ accessToken: "ig-token", metadata: { instagramUserId: "ig-1" } }).executeContactAction({
        workspaceId: "w",
        socialAccountId: "a",
        socialProfileId: "p",
        leadId: "l",
        action: "MESSAGE",
        body: "Hi",
        target: { externalProfileId: "leaduser", username: "@leaduser" },
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      new InstagramAdapter().executeContactAction({
        workspaceId: "w",
        socialAccountId: "a",
        socialProfileId: "p",
        leadId: "l",
        action: "MESSAGE",
        body: "Hi",
        target: { externalProfileId: "700", username: null },
      }),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });
});

describe("PHASE 18 campaign gating", () => {
  it("includes Facebook and Instagram MESSAGE and still skips VK INVITE", async () => {
    expect((await getSocialAdapter("facebook").getCapabilities()).messaging).toBe(true);
    expect((await getSocialAdapter("instagram").getCapabilities()).messaging).toBe(true);
    expect((await getSocialAdapter("vk").getCapabilities()).messaging).toBe(false);
    const messagePlatforms = await platformsSupportingCampaignAction(
      ["telegram", "x", "facebook", "instagram", "vk"],
      "MESSAGE",
    );
    expect([...messagePlatforms].sort()).toEqual(["facebook", "instagram", "telegram", "x"]);
    expect((await platformsSupportingCampaignAction(["facebook", "instagram", "vk"], "INVITE")).size).toBe(0);
  });
});
