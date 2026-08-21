import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  filterMessagesAfterCursor,
  laterDigitId,
  laterNamedInboxCursor,
  parseNamedInboxCursor,
  serializeNamedInboxCursor,
} from "@/lib/inbox/cursor";
import { laterUpdateStreamCursor } from "@/lib/social/update-stream";
import { FACEBOOK_GRAPH_ORIGIN } from "@/social/facebook/graph";
import { FacebookAdapter } from "@/social/facebook/adapter";
import { InstagramAdapter } from "@/social/instagram/adapter";
import { INSTAGRAM_GRAPH_ORIGIN } from "@/social/instagram/publish";
import { VkAdapter } from "@/social/vk/adapter";
import { vkMethodUrl } from "@/social/vk/api";
import { XAdapter } from "@/social/x/adapter";
import { parseXDirectMessageEvents, parseXInboxCursor } from "@/social/x/inbox";

describe("PHASE 21 inbox cursors", () => {
  it("parses named watermarks and keeps independent keys later", () => {
    expect(parseNamedInboxCursor("mentions:10|dms:5")).toEqual({ mentions: "10", dms: "5" });
    expect(serializeNamedInboxCursor({ dms: "5", mentions: "10" })).toBe("dms:5|mentions:10");
    expect(laterNamedInboxCursor("mentions:10|dms:5", "mentions:9|dms:8")).toBe("dms:8|mentions:10");
    expect(laterDigitId("1770000000000000000", "1770000000000000001")).toBe("1770000000000000001");
    expect(laterUpdateStreamCursor("12", "10")).toBe("12");
    expect(laterUpdateStreamCursor("mentions:10|dms:5", "mentions:9|dms:8")).toBe("dms:8|mentions:10");
    expect(laterUpdateStreamCursor("1770000000000000000", "1770000000000000001")).toBe("1770000000000000001");
    expect(
      filterMessagesAfterCursor(
        [
          { receivedAt: "2026-08-21T11:00:00+0000" },
          { receivedAt: "2026-08-21T12:00:00+0000" },
        ],
        "2026-08-21T11:00:00+0000",
      ),
    ).toEqual([{ receivedAt: "2026-08-21T12:00:00+0000" }]);
  });

  it("treats a legacy numeric X inbox cursor as the mentions watermark", () => {
    expect(parseXInboxCursor("12345")).toEqual({ mentions: "12345", dms: null });
    expect(parseXInboxCursor("mentions:99|dms:88")).toEqual({ mentions: "99", dms: "88" });
  });

  it("skips Direct Messages at or before the DM watermark", () => {
    const messages = parseXDirectMessageEvents(
      {
        data: [
          { id: "100", text: "old", sender_id: "200", created_at: "2026-08-21T10:00:00.000Z" },
          { id: "101", text: "new", sender_id: "200", created_at: "2026-08-21T11:00:00.000Z" },
        ],
        includes: { users: [{ id: "200", username: "lead" }] },
      },
      "1",
      "100",
    );
    expect(messages.map((item) => item.externalId)).toEqual(["101"]);
  });
});

describe("PHASE 21 collector watermarks", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends X mention since_id from the mentions watermark and returns a split cursor", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.startsWith("https://api.x.com/2/users/me")) {
        return new Response(JSON.stringify({ data: { id: "100", username: "hub" } }), { status: 200 });
      }
      if (target.includes("/mentions")) {
        expect(target).toContain("since_id=50");
        return new Response(
          JSON.stringify({
            data: [{ id: "60", text: "@hub hello", author_id: "200", created_at: "2026-08-21T12:00:00.000Z" }],
            includes: { users: [{ id: "200", username: "lead" }] },
            meta: { newest_id: "60" },
          }),
          { status: 200 },
        );
      }
      expect(target).toContain("https://api.x.com/2/dm_events");
      return new Response(
        JSON.stringify({
          data: [{ id: "80", text: "private hello", sender_id: "300", created_at: "2026-08-21T10:00:00.000Z" }],
          includes: { users: [{ id: "300", username: "dmlead" }] },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new XAdapter({ accessToken: "x-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: "mentions:50|dms:70",
    });
    expect(result.cursor).toBe("dms:80|mentions:60");
    expect(result.messages.map((item) => item.externalId)).toEqual(["60", "80"]);
  });

  it("advances independent Facebook comment and Messenger watermarks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
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
                        id: "old-c",
                        message: "old comment",
                        from: { id: "800", name: "Commenter" },
                        created_time: "2026-08-21T10:00:00+0000",
                      },
                      {
                        id: "new-c",
                        message: "new comment",
                        from: { id: "800", name: "Commenter" },
                        created_time: "2026-08-21T12:00:00+0000",
                      },
                    ],
                  },
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            data: [
              {
                messages: {
                  data: [
                    {
                      id: "old-m",
                      message: "old dm",
                      from: { id: "900", name: "Lead" },
                      created_time: "2026-08-21T09:00:00+0000",
                    },
                    {
                      id: "new-m",
                      message: "new dm",
                      from: { id: "900", name: "Lead" },
                      created_time: "2026-08-21T11:00:00+0000",
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        );
      }),
    );

    const result = await new FacebookAdapter({ accessToken: "user-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: "comments:2026-08-21T10:00:00+0000|messages:2026-08-21T09:00:00+0000",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["new-c", "new-m"]);
    expect(result.cursor).toBe(
      "comments:2026-08-21T12:00:00+0000|messages:2026-08-21T11:00:00+0000|threads:done",
    );
  });

  it("advances independent Instagram comment and DM watermarks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const target = String(url);
        if (target.includes("/ig-1/media")) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: "media-1",
                  comments: {
                    data: [
                      {
                        id: "old-c",
                        text: "old",
                        from: { id: "80", username: "fan" },
                        timestamp: "2026-08-21T08:00:00+0000",
                      },
                      {
                        id: "new-c",
                        text: "new",
                        from: { id: "80", username: "fan" },
                        timestamp: "2026-08-21T10:00:00+0000",
                      },
                    ],
                  },
                },
              ],
            }),
            { status: 200 },
          );
        }
        expect(target).toContain(`${INSTAGRAM_GRAPH_ORIGIN}/ig-1/conversations`);
        return new Response(
          JSON.stringify({
            data: [
              {
                messages: {
                  data: [
                    {
                      id: "old-m",
                      message: "old dm",
                      from: { id: "700", username: "lead" },
                      created_time: "2026-08-21T07:00:00+0000",
                    },
                    {
                      id: "new-m",
                      message: "new dm",
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
      }),
    );

    const result = await new InstagramAdapter({
      accessToken: "ig-token",
      metadata: { instagramUserId: "ig-1" },
    }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: "comments:2026-08-21T08:00:00+0000|messages:2026-08-21T07:00:00+0000",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["new-c", "new-m"]);
    expect(result.cursor).toBe(
      "comments:2026-08-21T10:00:00+0000|messages:2026-08-21T09:00:00+0000|threads:done",
    );
  });

  it("advances a VK unix comment cursor and skips older wall comments", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const target = String(url);
        if (target === vkMethodUrl("wall.get")) {
          return new Response(JSON.stringify({ response: { items: [{ id: 20, owner_id: 10 }] } }), { status: 200 });
        }
        expect(target).toBe(vkMethodUrl("wall.getComments"));
        return new Response(
          JSON.stringify({
            response: {
              items: [
                { id: 1, from_id: 42, text: "old", date: 1710000000 },
                { id: 2, from_id: 42, text: "new", date: 1710000099 },
              ],
            },
          }),
          { status: 200 },
        );
      }),
    );

    const result = await new VkAdapter({ accessToken: "vk-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: "1710000000",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["10:20:2"]);
    expect(result.cursor).toBe("comments:1710000099|wall:1|wallcomments:1");
  });
});

describe("PHASE 21 source boundaries", () => {
  it("persists inbox cursors without a worker platform switch", () => {
    const worker = readFileSync("services/jobs/worker-service.ts", "utf8");
    expect(worker).toContain("laterUpdateStreamCursor");
    expect(worker).toContain("adapter.collectInbox");
    expect(worker).toContain("inboxCursor");
    expect(worker).not.toMatch(/if\s*\(\s*platform\s*===/);
    const facebook = readFileSync("social/facebook/inbox.ts", "utf8");
    const instagram = readFileSync("social/instagram/inbox.ts", "utf8");
    const vk = readFileSync("social/vk/inbox.ts", "utf8");
    expect(facebook).toContain("filterMessagesAfterCursor");
    expect(instagram).toContain("filterMessagesAfterCursor");
    expect(vk).toContain("filterMessagesAfterCursor");
    expect(readFileSync("social/x/inbox.ts", "utf8")).toContain("since_id");
  });
});
