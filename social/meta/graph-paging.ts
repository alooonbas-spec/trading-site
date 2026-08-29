import { z } from "zod";

export const GRAPH_PAGE_DONE = "done";
export const GRAPH_OBJECT_ID = /^[A-Za-z0-9_]+$/;
export const GRAPH_REPLIES_FETCH_LIMIT = 20;

export type GraphRepliesMap = Record<string, string>;

export const graphPagingSchema = z
  .object({
    next: z.string().optional(),
    cursors: z
      .object({
        after: z.string().optional(),
        before: z.string().optional(),
      })
      .optional(),
  })
  .optional();

export function encodeGraphAfter(after: string): string {
  return Buffer.from(after, "utf8").toString("base64url");
}

export function decodeGraphAfter(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw || raw === GRAPH_PAGE_DONE) {
    return null;
  }
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8").trim();
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

export function graphPagingAfter(payload: unknown): string | null {
  const parsed = z.object({ paging: graphPagingSchema }).safeParse(payload);
  if (!parsed.success) {
    return null;
  }
  const after = parsed.data.paging?.cursors?.after?.trim();
  if (after) {
    return after;
  }
  const next = parsed.data.paging?.next?.trim();
  if (!next) {
    return null;
  }
  try {
    return new URL(next).searchParams.get("after");
  } catch {
    return null;
  }
}

export function encodeGraphReplies(map: GraphRepliesMap): string {
  const entries = Object.entries(map).filter(([id, after]) => GRAPH_OBJECT_ID.test(id) && after.trim().length > 0);
  if (entries.length === 0) {
    return GRAPH_PAGE_DONE;
  }
  entries.sort(([left], [right]) => left.localeCompare(right));
  return encodeGraphAfter(JSON.stringify(Object.fromEntries(entries.slice(0, GRAPH_REPLIES_FETCH_LIMIT))));
}

export function decodeGraphReplies(value: string | undefined): GraphRepliesMap | null {
  if (!value || value === GRAPH_PAGE_DONE) {
    return null;
  }
  const json = decodeGraphAfter(value);
  if (!json) {
    return null;
  }
  try {
    const parsed = z.record(z.string(), z.string().min(1)).safeParse(JSON.parse(json) as unknown);
    if (!parsed.success) {
      return null;
    }
    const map: GraphRepliesMap = {};
    for (const [id, after] of Object.entries(parsed.data)) {
      if (GRAPH_OBJECT_ID.test(id) && after.trim()) {
        map[id] = after.trim();
      }
    }
    return Object.keys(map).length > 0 ? map : null;
  } catch {
    return null;
  }
}

export function nextGraphRepliesCursor(input: {
  stored?: string;
  nestedAfters: GraphRepliesMap;
  fetchedNextAfters: GraphRepliesMap;
  fetchedIds: string[];
}): string {
  if (input.stored === GRAPH_PAGE_DONE) {
    return GRAPH_PAGE_DONE;
  }
  const stored = decodeGraphReplies(input.stored);
  if (!stored) {
    return encodeGraphReplies(input.nestedAfters);
  }
  const fetched = new Set(input.fetchedIds);
  const next: GraphRepliesMap = { ...input.fetchedNextAfters };
  for (const [id, after] of Object.entries(stored)) {
    if (!fetched.has(id)) {
      next[id] = after;
    }
  }
  for (const [id, after] of Object.entries(input.nestedAfters)) {
    if (!fetched.has(id) && stored[id] === undefined) {
      next[id] = after;
    }
  }
  return encodeGraphReplies(next);
}

export function nextGraphAfterCursor(input: {
  stored?: string;
  firstPageAfter: string | null;
  olderPageAfter: string | null;
  fetchedOlder: boolean;
}): string {
  if (input.stored === GRAPH_PAGE_DONE) {
    return GRAPH_PAGE_DONE;
  }
  if (!input.fetchedOlder) {
    return input.firstPageAfter ? encodeGraphAfter(input.firstPageAfter) : GRAPH_PAGE_DONE;
  }
  return input.olderPageAfter ? encodeGraphAfter(input.olderPageAfter) : GRAPH_PAGE_DONE;
}
