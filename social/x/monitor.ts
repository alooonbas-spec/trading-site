import { z } from "zod";
import { SocialError, ValidationError } from "@/lib/errors";
import {
  laterDigitId,
  parseNamedInboxCursor,
  serializeNamedInboxCursor,
} from "@/lib/inbox/cursor";
import { matchKeywords, normalizeKeywords } from "@/lib/monitoring/keywords";
import { readJson, socialFetch } from "@/social/core/http";
import type { MonitorInput, MonitorResult } from "@/social/core/adapter";
import { decodeXPageToken, nextXPageCursor } from "@/social/x/paging";

export const X_RECENT_SEARCH_URL = "https://api.x.com/2/tweets/search/recent";

const xRecentSearchResponseSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string().min(1),
        text: z.string(),
        author_id: z.string().optional(),
      }),
    )
    .optional(),
  includes: z
    .object({
      users: z
        .array(
          z.object({
            id: z.string(),
            username: z.string().optional(),
            name: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  meta: z
    .object({
      newest_id: z.string().optional(),
      next_token: z.string().optional(),
      result_count: z.number().optional(),
    })
    .optional(),
});

export function buildXRecentSearchQuery(keywords: string[]): string {
  const normalized = normalizeKeywords(keywords);
  if (normalized.length === 0) {
    throw new ValidationError("Monitoring requires at least one keyword");
  }

  return normalized.map((keyword) => `"${keyword.replaceAll('"', "")}"`).join(" OR ");
}

export function xRecentSearchSinceId(cursor?: string | null): string | undefined {
  const value = cursor?.trim();
  if (!value) {
    return undefined;
  }
  if (/^\d+$/.test(value)) {
    return value;
  }
  const tweets = parseNamedInboxCursor(value).tweets?.trim();
  if (tweets && /^\d+$/.test(tweets)) {
    return tweets;
  }
  return undefined;
}

export function parseXRecentSearch(payload: unknown, keywords: string[]): MonitorResult & { nextToken: string | null } {
  const parsed = xRecentSearchResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("X recent search returned an unexpected payload");
  }

  const users = new Map((parsed.data.includes?.users ?? []).map((user) => [user.id, user]));
  const events: MonitorResult["events"] = [];
  for (const tweet of parsed.data.data ?? []) {
    const matchedKeywords = matchKeywords(tweet.text, keywords);
    if (matchedKeywords.length === 0) {
      continue;
    }
    const author = tweet.author_id ? users.get(tweet.author_id) : undefined;
    events.push({
      externalId: tweet.id,
      author: author?.username ? `@${author.username}` : (author?.name ?? null),
      content: tweet.text,
      url: author?.username ? `https://x.com/${author.username}/status/${tweet.id}` : `https://x.com/i/web/status/${tweet.id}`,
      matchedKeywords,
    });
  }

  const nextToken = parsed.data.meta?.next_token?.trim() || null;
  return {
    events,
    cursor: parsed.data.meta?.newest_id ?? null,
    nextToken,
  };
}

function uniqueMonitorEvents(events: MonitorResult["events"]): MonitorResult["events"] {
  const seen = new Set<string>();
  const unique: MonitorResult["events"] = [];
  for (const event of events) {
    if (seen.has(event.externalId)) {
      continue;
    }
    seen.add(event.externalId);
    unique.push(event);
  }
  return unique;
}

async function searchXRecent(
  accessToken: string,
  query: string,
  keywords: string[],
  input: { sinceId?: string; paginationToken?: string },
): Promise<MonitorResult & { nextToken: string | null }> {
  const url = new URL(X_RECENT_SEARCH_URL);
  url.searchParams.set("query", query);
  url.searchParams.set("max_results", "10");
  url.searchParams.set("tweet.fields", "author_id,created_at");
  url.searchParams.set("expansions", "author_id");
  url.searchParams.set("user.fields", "username,name");
  if (input.paginationToken) {
    url.searchParams.set("pagination_token", input.paginationToken);
  } else if (input.sinceId) {
    url.searchParams.set("since_id", input.sinceId);
  }
  const response = await socialFetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseXRecentSearch(await readJson<unknown>(response), keywords);
}

export async function collectXRecentSearch(accessToken: string, input: MonitorInput): Promise<MonitorResult> {
  const query = buildXRecentSearchQuery(input.keywords);
  const sinceId = xRecentSearchSinceId(input.cursor);
  const named = parseNamedInboxCursor(input.cursor);
  const olderToken = decodeXPageToken(named.pages);
  const emptyPage = { events: [] as MonitorResult["events"], cursor: null as string | null, nextToken: null as string | null };
  const [latest, extra] = await Promise.all([
    searchXRecent(accessToken, query, input.keywords, { sinceId }),
    olderToken
      ? searchXRecent(accessToken, query, input.keywords, { paginationToken: olderToken })
      : Promise.resolve(emptyPage),
  ]);
  return {
    events: uniqueMonitorEvents([...latest.events, ...extra.events]),
    cursor: serializeNamedInboxCursor({
      pages: nextXPageCursor({
        stored: named.pages,
        firstPageToken: latest.nextToken,
        olderPageToken: extra.nextToken,
        fetchedOlder: Boolean(olderToken),
      }),
      tweets: laterDigitId(sinceId, laterDigitId(latest.cursor, extra.cursor)) ?? "",
    }),
  };
}
