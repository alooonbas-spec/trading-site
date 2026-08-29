import { z } from "zod";
import { SocialError, ValidationError } from "@/lib/errors";
import {
  laterDigitId,
  parseNamedInboxCursor,
  serializeNamedInboxCursor,
} from "@/lib/inbox/cursor";
import { matchKeywords, normalizeKeywords } from "@/lib/monitoring/keywords";
import type { MonitorInput, MonitorResult } from "@/social/core/adapter";
import { vkCall } from "@/social/vk/api";

export const VK_SEARCH_PAGE_DONE = "done";

const searchSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.number(),
        owner_id: z.number().optional(),
        from_id: z.number().optional(),
        date: z.number().optional(),
        text: z.string().optional(),
      }),
    )
    .optional(),
  profiles: z
    .array(
      z.object({
        id: z.number(),
        screen_name: z.string().optional(),
        first_name: z.string().optional(),
        last_name: z.string().optional(),
      }),
    )
    .optional(),
  groups: z
    .array(
      z.object({
        id: z.number(),
        screen_name: z.string().optional(),
        name: z.string().optional(),
      }),
    )
    .optional(),
  next_from: z.string().optional(),
});

export function buildVkNewsfeedSearchQuery(keywords: string[]): string {
  const normalized = normalizeKeywords(keywords);
  if (normalized.length === 0) {
    throw new ValidationError("Monitoring requires at least one keyword");
  }
  return normalized.map((keyword) => `"${keyword.replaceAll('"', "")}"`).join(" | ");
}

export function vkNewsfeedSearchCursor(cursor?: string | null): string | undefined {
  const value = cursor?.trim();
  if (!value) {
    return undefined;
  }
  if (/^\d{10}$/.test(value)) {
    return value;
  }
  const time = parseNamedInboxCursor(value).time?.trim();
  if (time && /^\d{10}$/.test(time)) {
    return time;
  }
  return undefined;
}

export function encodeVkSearchFrom(startFrom: string): string {
  return Buffer.from(startFrom, "utf8").toString("base64url");
}

export function decodeVkSearchFrom(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw || raw === VK_SEARCH_PAGE_DONE) {
    return null;
  }
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8").trim();
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

export function nextVkSearchPageCursor(input: {
  stored?: string;
  firstPageFrom: string | null;
  olderPageFrom: string | null;
  fetchedOlder: boolean;
}): string {
  if (input.stored === VK_SEARCH_PAGE_DONE) {
    return VK_SEARCH_PAGE_DONE;
  }
  if (!input.fetchedOlder) {
    return input.firstPageFrom ? encodeVkSearchFrom(input.firstPageFrom) : VK_SEARCH_PAGE_DONE;
  }
  return input.olderPageFrom ? encodeVkSearchFrom(input.olderPageFrom) : VK_SEARCH_PAGE_DONE;
}

function authorLabel(
  fromId: number | undefined,
  profiles: Map<number, { screen_name?: string; first_name?: string; last_name?: string }>,
  groups: Map<number, { screen_name?: string; name?: string }>,
): string | null {
  if (fromId === undefined || fromId === 0) {
    return null;
  }
  if (fromId > 0) {
    const profile = profiles.get(fromId);
    if (!profile) {
      return null;
    }
    if (profile.screen_name) {
      return `@${profile.screen_name}`;
    }
    const name = [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim();
    return name || null;
  }

  const group = groups.get(Math.abs(fromId));
  if (!group) {
    return null;
  }
  return group.screen_name ? `@${group.screen_name}` : (group.name ?? null);
}

export function parseVkNewsfeedSearch(
  payload: unknown,
  keywords: string[],
): MonitorResult & { nextFrom: string | null } {
  const parsed = searchSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("VK newsfeed.search returned an unexpected payload");
  }

  const profiles = new Map((parsed.data.profiles ?? []).map((profile) => [profile.id, profile]));
  const groups = new Map((parsed.data.groups ?? []).map((group) => [group.id, group]));
  const events = [];
  let newestDate = 0;

  for (const item of parsed.data.items ?? []) {
    if (item.date && item.date > newestDate) {
      newestDate = item.date;
    }
    const text = item.text?.trim();
    if (!text || item.owner_id === undefined) {
      continue;
    }
    const matchedKeywords = matchKeywords(text, keywords);
    if (matchedKeywords.length === 0) {
      continue;
    }
    events.push({
      externalId: `${item.owner_id}_${item.id}`,
      author: authorLabel(item.from_id ?? item.owner_id, profiles, groups),
      content: text,
      url: `https://vk.com/wall${item.owner_id}_${item.id}`,
      matchedKeywords,
    });
  }

  return {
    events,
    cursor: newestDate > 0 ? String(newestDate) : null,
    nextFrom: parsed.data.next_from?.trim() || null,
  };
}

function uniqueVkNewsfeedEvents(events: MonitorResult["events"]): MonitorResult["events"] {
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

async function searchVkNewsfeed(
  accessToken: string,
  query: string,
  keywords: string[],
  input: { startTime?: string; startFrom?: string },
): Promise<MonitorResult & { nextFrom: string | null }> {
  const payload = await vkCall("newsfeed.search", {
    access_token: accessToken,
    q: query,
    count: "30",
    extended: "1",
    ...(input.startTime ? { start_time: input.startTime } : {}),
    ...(input.startFrom ? { start_from: input.startFrom } : {}),
  });
  return parseVkNewsfeedSearch(payload, keywords);
}

export async function collectVkNewsfeedSearch(
  accessToken: string,
  input: MonitorInput,
): Promise<MonitorResult> {
  const query = buildVkNewsfeedSearchQuery(input.keywords);
  const startTime = vkNewsfeedSearchCursor(input.cursor);
  const named = parseNamedInboxCursor(input.cursor);
  const olderFrom = decodeVkSearchFrom(named.pages);
  const emptyPage = { events: [] as MonitorResult["events"], cursor: null as string | null, nextFrom: null as string | null };
  const [latest, extra] = await Promise.all([
    searchVkNewsfeed(accessToken, query, input.keywords, { startTime }),
    olderFrom
      ? searchVkNewsfeed(accessToken, query, input.keywords, { startTime, startFrom: olderFrom })
      : Promise.resolve(emptyPage),
  ]);
  return {
    events: uniqueVkNewsfeedEvents([...latest.events, ...extra.events]),
    cursor: serializeNamedInboxCursor({
      pages: nextVkSearchPageCursor({
        stored: named.pages,
        firstPageFrom: latest.nextFrom,
        olderPageFrom: extra.nextFrom,
        fetchedOlder: Boolean(olderFrom),
      }),
      time: laterDigitId(startTime, laterDigitId(latest.cursor, extra.cursor)) ?? "",
    }),
  };
}

export function vkMonitorAccessToken(
  accessToken?: string,
  serviceToken = process.env.VK_SERVICE_TOKEN,
): string | null {
  if (accessToken?.trim()) {
    return accessToken.trim();
  }
  if (typeof serviceToken === "string" && serviceToken.trim()) {
    return serviceToken.trim();
  }
  return null;
}
