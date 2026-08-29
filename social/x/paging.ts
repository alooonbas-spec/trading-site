import { z } from "zod";

export const X_PAGE_DONE = "done";
export const X_TWEET_ID = /^\d+$/;
export const X_PAGE_MAP_FETCH_LIMIT = 20;

export type XPageMap = Record<string, string>;

export function encodeXPageToken(token: string): string {
  return Buffer.from(token, "utf8").toString("base64url");
}

export function decodeXPageToken(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw || raw === X_PAGE_DONE) {
    return null;
  }
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8").trim();
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

export function nextXPageCursor(input: {
  stored?: string;
  firstPageToken: string | null;
  olderPageToken: string | null;
  fetchedOlder: boolean;
}): string {
  if (input.stored === X_PAGE_DONE) {
    return X_PAGE_DONE;
  }
  if (!input.fetchedOlder) {
    return input.firstPageToken ? encodeXPageToken(input.firstPageToken) : X_PAGE_DONE;
  }
  return input.olderPageToken ? encodeXPageToken(input.olderPageToken) : X_PAGE_DONE;
}

export function encodeXPageMap(map: XPageMap): string {
  const entries = Object.entries(map).filter(([id, token]) => X_TWEET_ID.test(id) && token.trim().length > 0);
  if (entries.length === 0) {
    return X_PAGE_DONE;
  }
  entries.sort(([left], [right]) => left.localeCompare(right));
  return encodeXPageToken(JSON.stringify(Object.fromEntries(entries.slice(0, X_PAGE_MAP_FETCH_LIMIT))));
}

export function decodeXPageMap(value: string | undefined): XPageMap | null {
  if (!value || value === X_PAGE_DONE) {
    return null;
  }
  const json = decodeXPageToken(value);
  if (!json) {
    return null;
  }
  try {
    const parsed = z.record(z.string(), z.string().min(1)).safeParse(JSON.parse(json) as unknown);
    if (!parsed.success) {
      return null;
    }
    const map: XPageMap = {};
    for (const [id, token] of Object.entries(parsed.data)) {
      if (X_TWEET_ID.test(id) && token.trim()) {
        map[id] = token.trim();
      }
    }
    return Object.keys(map).length > 0 ? map : null;
  } catch {
    return null;
  }
}

export function nextXPageMapCursor(input: {
  stored?: string;
  nestedTokens: XPageMap;
  fetchedNextTokens: XPageMap;
  fetchedIds: string[];
}): string {
  if (input.stored === X_PAGE_DONE) {
    return X_PAGE_DONE;
  }
  const stored = decodeXPageMap(input.stored);
  if (!stored) {
    return encodeXPageMap(input.nestedTokens);
  }
  const fetched = new Set(input.fetchedIds);
  const next: XPageMap = { ...input.fetchedNextTokens };
  for (const [id, token] of Object.entries(stored)) {
    if (!fetched.has(id)) {
      next[id] = token;
    }
  }
  for (const [id, token] of Object.entries(input.nestedTokens)) {
    if (!fetched.has(id) && stored[id] === undefined) {
      next[id] = token;
    }
  }
  return encodeXPageMap(next);
}
