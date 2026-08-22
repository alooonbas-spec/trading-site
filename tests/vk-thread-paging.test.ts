import { describe, expect, it } from "vitest";
import {
  decodeVkThreadMap,
  encodeVkThreadMap,
  nextVkThreadCursor,
  parseVkThreadId,
  VK_THREAD_FETCH_LIMIT,
  VK_THREAD_PAGE_DONE,
} from "@/social/vk/thread-paging";

describe("encodeVkThreadMap / decodeVkThreadMap", () => {
  it("round-trips a thread map", () => {
    const map = { "10_20_80": "5", "-55_9_4": "12" };
    expect(decodeVkThreadMap(encodeVkThreadMap(map))).toEqual(map);
  });

  it("encodes an empty or fully-invalid map as done", () => {
    expect(encodeVkThreadMap({})).toBe(VK_THREAD_PAGE_DONE);
    expect(encodeVkThreadMap({ "not-a-thread-id": "5" })).toBe(VK_THREAD_PAGE_DONE);
  });

  it("drops entries with a malformed thread id, a non-numeric page, or a zero page", () => {
    const encoded = encodeVkThreadMap({
      "10_20_80": "5",
      "bad-id": "5",
      "10_20_81": "not-a-number",
      "10_20_82": "0",
    });
    expect(decodeVkThreadMap(encoded)).toEqual({ "10_20_80": "5" });
  });

  it("caps the encoded map at VK_THREAD_FETCH_LIMIT entries, keeping the lexicographically first", () => {
    const map: Record<string, string> = {};
    for (let i = 0; i < VK_THREAD_FETCH_LIMIT + 5; i += 1) {
      map[`10_20_${String(i).padStart(3, "0")}`] = "1";
    }
    const decoded = decodeVkThreadMap(encodeVkThreadMap(map));
    expect(Object.keys(decoded ?? {})).toHaveLength(VK_THREAD_FETCH_LIMIT);
    expect(decoded).toHaveProperty("10_20_000");
    expect(decoded).not.toHaveProperty(`10_20_${VK_THREAD_FETCH_LIMIT}`);
  });

  it("decodes done, undefined, and garbage as null rather than throwing", () => {
    expect(decodeVkThreadMap(VK_THREAD_PAGE_DONE)).toBeNull();
    expect(decodeVkThreadMap(undefined)).toBeNull();
    expect(decodeVkThreadMap("not-valid-base64url-json")).toBeNull();
  });
});

describe("parseVkThreadId", () => {
  it("splits ownerId_postId_commentId, including a negative (community) owner id", () => {
    expect(parseVkThreadId("10_20_80")).toEqual({ ownerId: "10", postId: "20", commentId: "80" });
    expect(parseVkThreadId("-55_9_4")).toEqual({ ownerId: "-55", postId: "9", commentId: "4" });
  });

  it("rejects a malformed id", () => {
    expect(parseVkThreadId("10:20:80")).toBeNull();
    expect(parseVkThreadId("10_20")).toBeNull();
  });
});

describe("nextVkThreadCursor", () => {
  it("stays done once stored is done, ignoring any newly discovered threads", () => {
    expect(
      nextVkThreadCursor({
        stored: VK_THREAD_PAGE_DONE,
        nestedAfters: { "10_20_80": "5" },
        fetchedNextAfters: {},
        fetchedIds: [],
      }),
    ).toBe(VK_THREAD_PAGE_DONE);
  });

  it("seeds the map fresh from nestedAfters when nothing was stored yet", () => {
    const cursor = nextVkThreadCursor({
      stored: undefined,
      nestedAfters: { "10_20_80": "5", "10_20_81": "3" },
      fetchedNextAfters: {},
      fetchedIds: [],
    });
    expect(decodeVkThreadMap(cursor)).toEqual({ "10_20_80": "5", "10_20_81": "3" });
  });

  it("keeps a stored thread untouched this round if it was not fetched", () => {
    const stored = encodeVkThreadMap({ "10_20_80": "5" });
    const cursor = nextVkThreadCursor({
      stored,
      nestedAfters: {},
      fetchedNextAfters: {},
      fetchedIds: [],
    });
    expect(decodeVkThreadMap(cursor)).toEqual({ "10_20_80": "5" });
  });

  it("replaces a fetched thread's page with its new next-after", () => {
    const stored = encodeVkThreadMap({ "10_20_80": "5" });
    const cursor = nextVkThreadCursor({
      stored,
      nestedAfters: {},
      fetchedNextAfters: { "10_20_80": "10" },
      fetchedIds: ["10_20_80"],
    });
    expect(decodeVkThreadMap(cursor)).toEqual({ "10_20_80": "10" });
  });

  it("drops a fetched thread entirely once it has no further page (exhausted)", () => {
    const stored = encodeVkThreadMap({ "10_20_80": "5", "10_20_81": "3" });
    const cursor = nextVkThreadCursor({
      stored,
      nestedAfters: {},
      fetchedNextAfters: {},
      fetchedIds: ["10_20_80"],
    });
    expect(decodeVkThreadMap(cursor)).toEqual({ "10_20_81": "3" });
  });

  it("adds a newly discovered thread this round without disturbing untouched stored ones", () => {
    const stored = encodeVkThreadMap({ "10_20_80": "5" });
    const cursor = nextVkThreadCursor({
      stored,
      nestedAfters: { "10_20_90": "1" },
      fetchedNextAfters: {},
      fetchedIds: [],
    });
    expect(decodeVkThreadMap(cursor)).toEqual({ "10_20_80": "5", "10_20_90": "1" });
  });

  it("does not let nestedAfters resurrect a thread that was already stored (stored wins over stale nestedAfters)", () => {
    const stored = encodeVkThreadMap({ "10_20_80": "5" });
    const cursor = nextVkThreadCursor({
      stored,
      nestedAfters: { "10_20_80": "1" },
      fetchedNextAfters: {},
      fetchedIds: [],
    });
    expect(decodeVkThreadMap(cursor)).toEqual({ "10_20_80": "5" });
  });

  it("becomes done once every stored thread is fetched and exhausted", () => {
    const stored = encodeVkThreadMap({ "10_20_80": "5" });
    const cursor = nextVkThreadCursor({
      stored,
      nestedAfters: {},
      fetchedNextAfters: {},
      fetchedIds: ["10_20_80"],
    });
    expect(cursor).toBe(VK_THREAD_PAGE_DONE);
  });
});
