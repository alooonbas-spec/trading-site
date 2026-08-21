import { z } from "zod";

export const GRAPH_PAGE_DONE = "done";

const pagingSchema = z
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
  const parsed = z.object({ paging: pagingSchema }).safeParse(payload);
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
