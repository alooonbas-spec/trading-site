import { z } from "zod";

export const DEFAULT_PAGE_SIZE = 200;

const cursorSchema = z.object({
  at: z.string().min(10),
  id: z.uuid(),
});

export type KeysetCursor = {
  at: string;
  id: string;
};

export type KeysetPage<T> = {
  items: T[];
  nextCursor: string | null;
};

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function encodeKeysetCursor(cursor: KeysetCursor): string {
  return Buffer.from(JSON.stringify({ at: cursor.at, id: cursor.id }), "utf8").toString("base64url");
}

export function parseKeysetCursor(value: string | undefined): KeysetCursor | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const raw = Buffer.from(value, "base64url").toString("utf8");
    const parsed = cursorSchema.safeParse(JSON.parse(raw) as unknown);
    if (!parsed.success || !ISO_INSTANT.test(parsed.data.at) || !Number.isFinite(Date.parse(parsed.data.at))) {
      return undefined;
    }
    return parsed.data;
  } catch {
    return undefined;
  }
}

export function keysetOrFilter(cursor: KeysetCursor): string {
  const at = new Date(cursor.at).toISOString();
  return `created_at.lt."${at}",and(created_at.eq."${at}",id.lt.${cursor.id})`;
}

export function splitKeysetRows<T>(rows: T[], pageSize: number): { page: T[]; hasMore: boolean } {
  const hasMore = rows.length > pageSize;
  return {
    page: hasMore ? rows.slice(0, pageSize) : rows,
    hasMore,
  };
}

export function nextKeysetCursor(
  page: Array<{ id: string; created_at?: string; createdAt?: string }>,
  hasMore: boolean,
): string | null {
  if (!hasMore) {
    return null;
  }
  const last = page[page.length - 1];
  const at = last?.createdAt ?? last?.created_at;
  if (!last || !at) {
    return null;
  }
  return encodeKeysetCursor({ at, id: last.id });
}

export function searchHref(path: string, params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      search.set(key, value);
    }
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}
