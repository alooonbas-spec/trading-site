import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAGE_SIZE,
  encodeKeysetCursor,
  keysetOrFilter,
  nextKeysetCursor,
  parseKeysetCursor,
  searchHref,
  splitKeysetRows,
} from "@/lib/pagination/keyset";

describe("keyset pagination", () => {
  it("encodes, parses, and rejects invented cursors", () => {
    const encoded = encodeKeysetCursor({
      at: "2026-08-21T22:00:00.000Z",
      id: "11111111-1111-4111-8111-111111111111",
    });
    expect(parseKeysetCursor(encoded)).toEqual({
      at: "2026-08-21T22:00:00.000Z",
      id: "11111111-1111-4111-8111-111111111111",
    });
    expect(parseKeysetCursor("not-a-cursor")).toBeUndefined();
    expect(parseKeysetCursor("")).toBeUndefined();
    expect(
      parseKeysetCursor(
        encodeKeysetCursor({ at: "tomorrow", id: "11111111-1111-4111-8111-111111111111" }),
      ),
    ).toBeUndefined();
  });

  it("splits a fetched window and builds an Older cursor from the last visible row", () => {
    const rows = [
      { id: "a", created_at: "2026-08-21T22:00:00.000Z" },
      { id: "b", created_at: "2026-08-21T21:00:00.000Z" },
      { id: "c", created_at: "2026-08-21T20:00:00.000Z" },
    ];
    const { page, hasMore } = splitKeysetRows(rows, 2);
    expect(page).toEqual(rows.slice(0, 2));
    expect(hasMore).toBe(true);
    expect(nextKeysetCursor(page, hasMore)).toBe(
      encodeKeysetCursor({ at: "2026-08-21T21:00:00.000Z", id: "b" }),
    );
    expect(nextKeysetCursor(rows, false)).toBeNull();
    expect(keysetOrFilter({ at: "2026-08-21T21:00:00.000Z", id: "b" })).toContain('created_at.lt."2026-08-21T21:00:00.000Z"');
    expect(keysetOrFilter({ at: "2026-08-21T21:00:00.000Z", id: "b" })).toContain("id.lt.b");
    expect(DEFAULT_PAGE_SIZE).toBe(200);
    expect(searchHref("/w/ws/jobs", { type: "INBOX", after: "c1" })).toBe("/w/ws/jobs?type=INBOX&after=c1");
  });
});

describe("PHASE 27 operator list pagination", () => {
  it("pages inbox, jobs, and activity with created_at keysets and no OFFSET", () => {
    const inbox = readFileSync("services/inbox/query-service.ts", "utf8");
    const jobs = readFileSync("services/jobs/query-service.ts", "utf8");
    const activity = readFileSync("services/activity/query-service.ts", "utf8");
    for (const source of [inbox, jobs, activity]) {
      expect(source).toContain("parseKeysetCursor");
      expect(source).toContain("keysetOrFilter");
      expect(source).toContain(".limit(");
      expect(source).toContain("nextKeysetCursor");
      expect(source).not.toMatch(/offset\(/i);
      expect(source).not.toMatch(/if\s*\(\s*platform\s*===/);
      expect(source).not.toContain("do_not_contact");
    }
    expect(inbox).toContain("INBOX_PAGE_SIZE + 1");
    expect(jobs).toContain("JOB_PAGE_SIZE + 1");
    expect(activity).toContain("ACTIVITY_PAGE_SIZE + 1");
  });

  it("exposes Newest/Older links on Inbox, Jobs, and Activity pages", () => {
    const inbox = readFileSync("app/(dashboard)/w/[workspaceId]/inbox/page.tsx", "utf8");
    const jobs = readFileSync("app/(dashboard)/w/[workspaceId]/jobs/page.tsx", "utf8");
    const activity = readFileSync("app/(dashboard)/w/[workspaceId]/activity/page.tsx", "utf8");
    for (const page of [inbox, jobs, activity]) {
      expect(page).toContain("ListPagination");
      expect(page).toContain("after:");
      expect(page).toContain("created_at keyset");
    }
  });
});
