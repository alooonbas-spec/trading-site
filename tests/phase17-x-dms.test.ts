import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthenticationError, UnsupportedActionError, ValidationError } from "@/lib/errors";
import {
  campaignActionSupportedByCapabilities,
  platformsSupportingCampaignAction,
  unsupportedCampaignActionMessage,
} from "@/lib/campaigns/contact-capabilities";
import { buildEnqueuePairs } from "@/lib/jobs/queue-rules";
import { DISABLED_CAPABILITIES } from "@/social/core/base-adapter";
import { getSocialAdapter } from "@/social/core/registry";
import { XAdapter, X_SCOPES, buildXAuthorizationUrl } from "@/social/x/adapter";
import { parseXDirectMessageEvents } from "@/social/x/inbox";
import { xDmConversationUrl, xUserByUsernameUrl } from "@/social/x/contact";
import { SOCIAL_PLATFORMS } from "@/types/social";

describe("PHASE 17 X Direct Messages", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.X_CLIENT_ID;
  });

  it("requests dm.read and dm.write on OAuth", () => {
    expect(X_SCOPES).toContain("dm.read");
    expect(X_SCOPES).toContain("dm.write");
    process.env.X_CLIENT_ID = "x-app";
    const url = buildXAuthorizationUrl({
      redirectUri: "http://localhost:3000/api/social/x/callback",
      state: "state-value-at-least-32-characters-long",
      codeChallenge: "challenge",
    });
    expect(url).toContain("dm.read");
    expect(url).toContain("dm.write");
  });

  it("parses inbound DMs and skips outbound or empty events", () => {
    const messages = parseXDirectMessageEvents(
      {
        data: [
          { id: "dm-out", text: "from hub", sender_id: "100" },
          { id: "dm-empty", sender_id: "200" },
          {
            id: "dm-in",
            text: "hello from lead",
            sender_id: "200",
            created_at: "2026-08-21T12:00:00.000Z",
          },
        ],
        includes: { users: [{ id: "200", username: "lead" }] },
      },
      "100",
    );

    expect(messages).toEqual([
      {
        externalId: "dm-in",
        externalProfileId: "200",
        username: "@lead",
        body: "hello from lead",
        url: null,
        receivedAt: "2026-08-21T12:00:00.000Z",
      },
    ]);
  });

  it("collects mentions and inbound DMs together", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.startsWith("https://api.x.com/2/users/me")) {
        return new Response(JSON.stringify({ data: { id: "100", username: "hub" } }), { status: 200 });
      }
      if (target.includes("/mentions")) {
        return new Response(
          JSON.stringify({
            data: [{ id: "tweet-1", text: "@hub hello", author_id: "200" }],
            includes: { users: [{ id: "200", username: "lead" }] },
            meta: { newest_id: "tweet-1" },
          }),
          { status: 200 },
        );
      }
      expect(target).toContain("https://api.x.com/2/dm_events");
      expect(target).toContain("event_types=MessageCreate");
      return new Response(
        JSON.stringify({
          data: [{ id: "dm-1", text: "private hello", sender_id: "300", created_at: "2026-08-21T10:00:00.000Z" }],
          includes: { users: [{ id: "300", username: "dmlead" }] },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new XAdapter({ accessToken: "x-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
    });
    expect(result.cursor).toBe("tweet-1");
    expect(result.messages).toEqual([
      expect.objectContaining({
        externalId: "tweet-1",
        externalProfileId: "200",
        username: "@lead",
        body: "@hub hello",
      }),
      {
        externalId: "dm-1",
        externalProfileId: "300",
        username: "@dmlead",
        body: "private hello",
        url: null,
        receivedAt: "2026-08-21T10:00:00.000Z",
      },
    ]);
  });

  it("fails inbox honestly when DMs are forbidden", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const target = String(url);
        if (target.startsWith("https://api.x.com/2/users/me")) {
          return new Response(JSON.stringify({ data: { id: "100", username: "hub" } }), { status: 200 });
        }
        if (target.includes("/mentions")) {
          return new Response(JSON.stringify({ data: [], meta: { newest_id: "1" } }), { status: 200 });
        }
        return new Response("forbidden", { status: 403 });
      }),
    );

    await expect(
      new XAdapter({ accessToken: "x-token" }).collectInbox({ workspaceId: "w", socialAccountId: "a" }),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("sends MESSAGE through official dm_conversations and refuses INVITE", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(xDmConversationUrl("200"));
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ text: "Hello lead" });
      return new Response(JSON.stringify({ data: { dm_event_id: "evt-9" } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new XAdapter({ accessToken: "x-token" });
    const sent = await adapter.executeContactAction({
      workspaceId: "w",
      socialAccountId: "a",
      socialProfileId: "p",
      leadId: "l",
      action: "MESSAGE",
      body: "Hello lead",
      target: { externalProfileId: "200", username: "@lead" },
    });
    expect(sent.status).toBe("SUCCESS");
    expect(sent.externalMessageId).toBe("evt-9");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(
      adapter.executeContactAction({
        workspaceId: "w",
        socialAccountId: "a",
        socialProfileId: "p",
        leadId: "l",
        action: "INVITE",
        target: { externalProfileId: "200", username: "@lead" },
      }),
    ).rejects.toBeInstanceOf(UnsupportedActionError);
  });

  it("resolves username-only X profiles through users/by/username", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      if (target === xUserByUsernameUrl("leaduser")) {
        return new Response(JSON.stringify({ data: { id: "555" } }), { status: 200 });
      }
      expect(target).toBe(xDmConversationUrl("555"));
      expect(JSON.parse(String(init?.body))).toEqual({ text: "Hi" });
      return new Response(JSON.stringify({ data: { dm_event_id: "evt-1" } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const sent = await new XAdapter({ accessToken: "x-token" }).executeContactAction({
      workspaceId: "w",
      socialAccountId: "a",
      socialProfileId: "p",
      leadId: "l",
      action: "MESSAGE",
      body: "Hi",
      target: { externalProfileId: "leaduser", username: "@leaduser" },
    });
    expect(sent.externalMessageId).toBe("evt-1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails MESSAGE honestly without a body or token", async () => {
    await expect(
      new XAdapter({ accessToken: "x-token" }).executeContactAction({
        workspaceId: "w",
        socialAccountId: "a",
        socialProfileId: "p",
        leadId: "l",
        action: "MESSAGE",
        body: "   ",
        target: { externalProfileId: "200", username: null },
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      new XAdapter().executeContactAction({
        workspaceId: "w",
        socialAccountId: "a",
        socialProfileId: "p",
        leadId: "l",
        action: "MESSAGE",
        body: "Hello",
        target: { externalProfileId: "200", username: null },
      }),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });
});

describe("PHASE 17 campaign contact gating", () => {
  it("enables X and Telegram MESSAGE and keeps INVITE disabled everywhere", async () => {
    expect((await getSocialAdapter("x").getCapabilities()).messaging).toBe(true);
    expect((await getSocialAdapter("x").getCapabilities()).contactActions).toBe(true);
    expect((await getSocialAdapter("x").getCapabilities()).invites).toBe(false);
    expect((await getSocialAdapter("telegram").getCapabilities()).messaging).toBe(true);
    expect((await getSocialAdapter("telegram").getCapabilities()).invites).toBe(false);
    expect((await getSocialAdapter("vk").getCapabilities()).messaging).toBe(false);
    expect((await getSocialAdapter("facebook").getCapabilities()).messaging).toBe(false);
    expect((await getSocialAdapter("instagram").getCapabilities()).messaging).toBe(false);

    for (const platform of SOCIAL_PLATFORMS) {
      expect((await getSocialAdapter(platform).getCapabilities()).invites).toBe(false);
    }
    expect(DISABLED_CAPABILITIES.invites).toBe(false);
  });

  it("filters MESSAGE pairs to messaging-capable accounts and INVITE to nobody", async () => {
    const matching = buildEnqueuePairs({
      leadIds: ["lead-ok"],
      skippedLeadIds: new Set(),
      accounts: [
        { id: "acc-tg", platform: "telegram" },
        { id: "acc-x", platform: "x" },
        { id: "acc-vk", platform: "vk" },
      ],
      profiles: [
        { id: "p-tg", leadId: "lead-ok", platform: "telegram" },
        { id: "p-x", leadId: "lead-ok", platform: "x" },
        { id: "p-vk", leadId: "lead-ok", platform: "vk" },
      ],
    });
    expect(matching).toHaveLength(3);

    const messagePlatforms = await platformsSupportingCampaignAction(
      ["telegram", "x", "vk"],
      "MESSAGE",
    );
    expect([...messagePlatforms].sort()).toEqual(["telegram", "x"]);
    const accountPlatform = new Map([
      ["acc-tg", "telegram" as const],
      ["acc-x", "x" as const],
      ["acc-vk", "vk" as const],
    ]);
    const messagePairs = matching.filter((pair) => {
      const platform = accountPlatform.get(pair.socialAccountId);
      return platform !== undefined && messagePlatforms.has(platform);
    });
    expect(messagePairs.map((pair) => pair.socialAccountId).sort()).toEqual(["acc-tg", "acc-x"]);

    expect(campaignActionSupportedByCapabilities("MESSAGE", { ...DISABLED_CAPABILITIES, messaging: true })).toBe(
      true,
    );
    expect(campaignActionSupportedByCapabilities("INVITE", { ...DISABLED_CAPABILITIES, messaging: true })).toBe(
      false,
    );
    expect(campaignActionSupportedByCapabilities("OPEN_PROFILE", DISABLED_CAPABILITIES)).toBe(true);

    const invitePlatforms = await platformsSupportingCampaignAction(["telegram", "x", "vk"], "INVITE");
    expect(invitePlatforms.size).toBe(0);
    expect(unsupportedCampaignActionMessage("INVITE")).toContain("No current adapter enables invites");
    expect(unsupportedCampaignActionMessage("MESSAGE")).toContain("dm.write");
  });

  it("gates enqueue through capabilities instead of platform switches", () => {
    const enqueue = readFileSync("services/jobs/enqueue-service.ts", "utf8");
    const worker = readFileSync("services/jobs/worker-service.ts", "utf8");
    expect(enqueue).toContain("platformsSupportingCampaignAction");
    expect(enqueue).not.toMatch(/if\s*\(\s*platform\s*===/);
    expect(worker).not.toMatch(/if\s*\(\s*platform\s*===/);
    expect(worker).toContain("executeContactAction");
  });
});
