import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeXPageToken } from "@/social/x/paging";
import { XAdapter } from "@/social/x/adapter";
import { xRecentSearchSinceId } from "@/social/x/monitor";

describe("X recent search cursor helpers", () => {
  it("reads legacy numeric and named tweets watermarks", () => {
    expect(xRecentSearchSinceId("2")).toBe("2");
    expect(xRecentSearchSinceId("pages:done|tweets:80")).toBe("80");
    expect(xRecentSearchSinceId("pages:done")).toBeUndefined();
  });
});

describe("PHASE 48 X recent search pagination_token", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("walks the next official recent search pagination_token and keeps older matches", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      expect(target).toContain("https://api.x.com/2/tweets/search/recent");
      expect(target).toContain("max_results=10");
      if (target.includes("pagination_token=page-2")) {
        expect(target).not.toContain("since_id=");
        return new Response(
          JSON.stringify({
            data: [{ id: "50", text: "older social hub", author_id: "u1" }],
            includes: { users: [{ id: "u1", username: "jack" }] },
          }),
          { status: 200 },
        );
      }
      expect(target).not.toContain("pagination_token=");
      return new Response(
        JSON.stringify({
          data: [{ id: "80", text: "newer social hub", author_id: "u1" }],
          includes: { users: [{ id: "u1", username: "jack" }] },
          meta: { newest_id: "80", next_token: "page-2" },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await new XAdapter({ accessToken: "x-token" }).monitor({
      workspaceId: "w",
      socialAccountId: "a",
      keywords: ["social hub"],
      sources: [],
    });
    expect(first.events.map((item) => item.externalId)).toEqual(["80"]);
    expect(first.cursor).toBe(`pages:${encodeXPageToken("page-2")}|tweets:80`);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("pagination_token="))).toHaveLength(0);

    const second = await new XAdapter({ accessToken: "x-token" }).monitor({
      workspaceId: "w",
      socialAccountId: "a",
      keywords: ["social hub"],
      sources: [],
      cursor: first.cursor,
    });
    expect(second.events.map((item) => item.externalId)).toEqual(["80", "50"]);
    expect(second.cursor).toBe("pages:done|tweets:80");
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("pagination_token=page-2"))).toHaveLength(1);
  });

  it("skips pagination_token once pages:done is stored", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.includes("pagination_token=")) {
        throw new Error(`unexpected pagination_token ${target}`);
      }
      expect(target).toContain("since_id=50");
      return new Response(
        JSON.stringify({
          data: [{ id: "60", text: "Hello social hub", author_id: "u1" }],
          includes: { users: [{ id: "u1", username: "jack" }] },
          meta: { newest_id: "60", next_token: "page-2" },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new XAdapter({ accessToken: "x-token" }).monitor({
      workspaceId: "w",
      socialAccountId: "a",
      keywords: ["social hub"],
      sources: [],
      cursor: "pages:done|tweets:50",
    });
    expect(result.events.map((item) => item.externalId)).toEqual(["60"]);
    expect(result.cursor).toBe("pages:done|tweets:60");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
