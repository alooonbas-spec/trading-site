import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeXPageToken, encodeXPageToken, nextXPageCursor } from "@/social/x/paging";
import { XAdapter } from "@/social/x/adapter";

describe("decodeXPageToken", () => {
  it("round-trips an encoded token", () => {
    expect(decodeXPageToken(encodeXPageToken("page-2"))).toBe("page-2");
  });

  it("treats undefined, done, and an empty/blank string as no cursor", () => {
    expect(decodeXPageToken(undefined)).toBeNull();
    expect(decodeXPageToken("done")).toBeNull();
    expect(decodeXPageToken("")).toBeNull();
    expect(decodeXPageToken("   ")).toBeNull();
  });

  it("treats input that decodes to nothing as null rather than throwing", () => {
    // Buffer.from(..., "base64url") silently drops invalid characters rather
    // than throwing, so a string made entirely of non-base64url characters
    // decodes to an empty buffer.
    expect(decodeXPageToken("!!!")).toBeNull();
  });
});

describe("X pagination helpers", () => {
  it("encodes next_token values and stays done once stored", () => {
    expect(encodeXPageToken("page-2")).toBe(Buffer.from("page-2", "utf8").toString("base64url"));
    expect(
      nextXPageCursor({
        firstPageToken: "page-2",
        olderPageToken: null,
        fetchedOlder: false,
      }),
    ).toBe(encodeXPageToken("page-2"));
    expect(
      nextXPageCursor({
        stored: encodeXPageToken("page-2"),
        firstPageToken: "page-2",
        olderPageToken: null,
        fetchedOlder: true,
      }),
    ).toBe("done");
    expect(
      nextXPageCursor({
        stored: "done",
        firstPageToken: "page-2",
        olderPageToken: "page-3",
        fetchedOlder: false,
      }),
    ).toBe("done");
  });
});

describe("PHASE 46 X mention and DM pagination_token", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("walks the next official dm_events pagination_token and keeps older DMs", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.startsWith("https://api.x.com/2/users/me")) {
        return new Response(JSON.stringify({ data: { id: "100", username: "hub" } }), { status: 200 });
      }
      if (target.includes("/mentions")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      expect(target).toContain("https://api.x.com/2/dm_events");
      expect(target).toContain("event_types=MessageCreate");
      if (target.includes("pagination_token=page-2")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "50",
                text: "older dm",
                sender_id: "300",
                created_at: "2026-08-20T09:00:00.000Z",
              },
            ],
            includes: { users: [{ id: "300", username: "dmlead" }] },
          }),
          { status: 200 },
        );
      }
      expect(target).not.toContain("pagination_token=");
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "80",
              text: "newer dm",
              sender_id: "300",
              created_at: "2026-08-21T12:00:00.000Z",
            },
          ],
          includes: { users: [{ id: "300", username: "dmlead" }] },
          meta: { next_token: "page-2" },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await new XAdapter({ accessToken: "x-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
    });
    expect(first.messages.map((item) => item.externalId)).toEqual(["80"]);
    expect(first.cursor).toBe(`dmpages:${encodeXPageToken("page-2")}|dms:80|mentionpages:done`);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes("pagination_token=")),
    ).toHaveLength(0);

    const second = await new XAdapter({ accessToken: "x-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: first.cursor,
    });
    expect(second.messages.map((item) => item.externalId)).toEqual(["50"]);
    expect(second.cursor).toBe("dmpages:done|dms:80|mentionpages:done");
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes("pagination_token=page-2")),
    ).toHaveLength(1);
  });

  it("skips mention pagination_token once mentionpages:done is stored", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.startsWith("https://api.x.com/2/users/me")) {
        return new Response(JSON.stringify({ data: { id: "100", username: "hub" } }), { status: 200 });
      }
      if (target.includes("pagination_token=")) {
        throw new Error(`unexpected pagination_token ${target}`);
      }
      if (target.includes("/mentions")) {
        expect(target).toContain("since_id=50");
        return new Response(
          JSON.stringify({
            data: [{ id: "60", text: "@hub hello", author_id: "200", created_at: "2026-08-21T12:00:00.000Z" }],
            includes: { users: [{ id: "200", username: "lead" }] },
            meta: { newest_id: "60", next_token: "mention-2" },
          }),
          { status: 200 },
        );
      }
      expect(target).toContain("https://api.x.com/2/dm_events");
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new XAdapter({ accessToken: "x-token" }).collectInbox({
      workspaceId: "w",
      socialAccountId: "a",
      cursor: "dmpages:done|dms:70|mentionpages:done|mentions:50",
    });
    expect(result.messages.map((item) => item.externalId)).toEqual(["60"]);
    expect(result.cursor).toBe("dmpages:done|dms:70|mentionpages:done|mentions:60");
  });
});
