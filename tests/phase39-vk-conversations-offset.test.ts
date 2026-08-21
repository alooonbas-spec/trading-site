import { afterEach, describe, expect, it, vi } from "vitest";
import { VkAdapter } from "@/social/vk/adapter";
import { vkMethodUrl } from "@/social/vk/api";
import { vkCommunityMetadata } from "@/social/vk/community";
import { parseVkInboxCursor } from "@/social/vk/inbox";

const communityMetadata = vkCommunityMetadata("12345");
const VK_CHAT_PEER_FLOOR = 2_000_000_000;

function conversationItem(
  peerId: number,
  type: "user" | "chat",
  messageId: number,
): {
  conversation: { peer: { id: number; type: "user" | "chat" } };
  last_message: { id: number; from_id: number; text: string; date: number; out: number };
} {
  return {
    conversation: { peer: { id: peerId, type } },
    last_message: {
      id: messageId,
      from_id: type === "user" ? peerId : 1,
      text: `peer ${peerId}`,
      date: 1710000000 + messageId,
      out: 0,
    },
  };
}

function fullOlderConversationPage(userPeerId: number): ReturnType<typeof conversationItem>[] {
  return [
    conversationItem(userPeerId, "user", 50),
    ...Array.from({ length: 19 }, (_, index) =>
      conversationItem(VK_CHAT_PEER_FLOOR + index, "chat", 1),
    ),
  ];
}

describe("VK community conversation offset cursor", () => {
  it("parses conversation pages and the done marker", () => {
    expect(parseVkInboxCursor("comments:1|conversations:2|history:done|messages:8")).toEqual({
      comments: "1",
      messages: "8",
      history: true,
      historyPage: "done",
      conversations: true,
      conversationsPage: 2,
    });
    expect(parseVkInboxCursor("comments:1|conversations:done|history:done|messages:8")).toEqual({
      comments: "1",
      messages: "8",
      history: true,
      historyPage: "done",
      conversations: true,
      conversationsPage: "done",
    });
  });
});

describe("PHASE 39 VK community conversation offset", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("walks the next official getConversations offset window after conversations:1", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      if (target === vkMethodUrl("wall.get")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("messages.getConversations")) {
        if (body.includes("offset=20")) {
          return new Response(
            JSON.stringify({
              response: {
                items: fullOlderConversationPage(99),
                profiles: [{ id: 99, screen_name: "older" }],
              },
            }),
            { status: 200 },
          );
        }
        expect(body).not.toContain("offset=");
        expect(body).toContain("count=20");
        return new Response(
          JSON.stringify({
            response: {
              items: [conversationItem(42, "user", 201)],
              profiles: [{ id: 42, screen_name: "latest" }],
            },
          }),
          { status: 200 },
        );
      }
      expect(target).toBe(vkMethodUrl("messages.getHistory"));
      expect(body).not.toContain("offset=");
      if (body.includes("peer_id=99")) {
        return new Response(
          JSON.stringify({
            response: {
              items: [{ id: 50, from_id: 99, text: "older peer", date: 1710000050, out: 0, peer_id: 99 }],
              profiles: [{ id: 99, screen_name: "older" }],
            },
          }),
          { status: 200 },
        );
      }
      expect(body).toContain("peer_id=42");
      return new Response(
        JSON.stringify({
          response: {
            items: [{ id: 201, from_id: 42, text: "newer", date: 1710000201, out: 0, peer_id: 42 }],
            profiles: [{ id: 42, screen_name: "latest" }],
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
      cursor: "comments:1710000000|conversations:1|history:done|messages:200",
    });
    expect(result.messages.map((item) => item.externalId).sort()).toEqual(["201", "50"]);
    expect(result.cursor).toBe("comments:1710000000|conversations:2|history:done|messages:201");
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("messages.getConversations")),
    ).toHaveLength(2);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("messages.getHistory")),
    ).toHaveLength(2);
  });

  it("stores conversations:done when the older getConversations window is short", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      if (target === vkMethodUrl("wall.get")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("messages.getConversations")) {
        if (body.includes("offset=20")) {
          return new Response(
            JSON.stringify({
              response: {
                items: [conversationItem(99, "user", 50)],
              },
            }),
            { status: 200 },
          );
        }
        expect(body).not.toContain("offset=");
        return new Response(
          JSON.stringify({
            response: {
              items: [conversationItem(42, "user", 201)],
            },
          }),
          { status: 200 },
        );
      }
      expect(target).toBe(vkMethodUrl("messages.getHistory"));
      if (body.includes("peer_id=99")) {
        return new Response(
          JSON.stringify({
            response: {
              items: [{ id: 50, from_id: 99, text: "older peer", date: 1710000050, out: 0, peer_id: 99 }],
            },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          response: {
            items: [{ id: 201, from_id: 42, text: "newer", date: 1710000201, out: 0, peer_id: 42 }],
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
      cursor: "comments:1710000000|conversations:1|history:done|messages:200",
    });
    expect(result.messages.map((item) => item.externalId).sort()).toEqual(["201", "50"]);
    expect(result.cursor).toBe("comments:1710000000|conversations:done|history:done|messages:201");
  });

  it("stops conversation offset when the older window is short and skips offset after done", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = String(init?.body ?? "");
      if (target === vkMethodUrl("wall.get")) {
        return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
      }
      if (target === vkMethodUrl("messages.getConversations")) {
        if (body.includes("offset=")) {
          throw new Error(`unexpected conversation offset ${body}`);
        }
        expect(body).toContain("count=20");
        return new Response(
          JSON.stringify({
            response: {
              items: [conversationItem(42, "user", 80)],
            },
          }),
          { status: 200 },
        );
      }
      expect(target).toBe(vkMethodUrl("messages.getHistory"));
      expect(body).not.toContain("offset=");
      return new Response(
        JSON.stringify({
          response: {
            items: [{ id: 81, from_id: 42, text: "newer", date: 1710000081, out: 0, peer_id: 42 }],
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
      cursor: "comments:1710000000|conversations:done|history:done|messages:80",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["81"]);
    expect(result.cursor).toBe("comments:1710000000|conversations:done|history:done|messages:81");
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === vkMethodUrl("messages.getConversations")),
    ).toHaveLength(1);
  });

  it("does not call messages.getConversations for user OAuth wall-comment inbox", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target === vkMethodUrl("wall.get")) {
        return new Response(JSON.stringify({ response: { items: [{ id: 20, owner_id: 10 }] } }), {
          status: 200,
        });
      }
      expect(target).toBe(vkMethodUrl("wall.getComments"));
      return new Response(JSON.stringify({ response: { items: [] } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await new VkAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: "1710000000",
    });
    expect(
      fetchMock.mock.calls.some(([url]) => String(url) === vkMethodUrl("messages.getConversations")),
    ).toBe(false);
  });
});
