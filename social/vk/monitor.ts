import { z } from "zod";
import { SocialError, ValidationError } from "@/lib/errors";
import { matchKeywords, normalizeKeywords } from "@/lib/monitoring/keywords";
import type { MonitorInput, MonitorResult } from "@/social/core/adapter";
import { vkCall } from "@/social/vk/api";

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
});

export function buildVkNewsfeedSearchQuery(keywords: string[]): string {
  const normalized = normalizeKeywords(keywords);
  if (normalized.length === 0) {
    throw new ValidationError("Monitoring requires at least one keyword");
  }
  return normalized.map((keyword) => `"${keyword.replaceAll('"', "")}"`).join(" | ");
}

export function vkNewsfeedSearchCursor(cursor?: string | null): string | undefined {
  if (cursor && /^\d{10}$/.test(cursor)) {
    return cursor;
  }
  return undefined;
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

export function parseVkNewsfeedSearch(payload: unknown, keywords: string[]): MonitorResult {
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
  };
}

export async function collectVkNewsfeedSearch(
  accessToken: string,
  input: MonitorInput,
): Promise<MonitorResult> {
  const query = buildVkNewsfeedSearchQuery(input.keywords);
  const startTime = vkNewsfeedSearchCursor(input.cursor);
  const payload = await vkCall("newsfeed.search", {
    access_token: accessToken,
    q: query,
    count: "30",
    extended: "1",
    ...(startTime ? { start_time: startTime } : {}),
  });
  const parsed = parseVkNewsfeedSearch(payload, input.keywords);
  return {
    events: parsed.events,
    cursor: parsed.cursor ?? input.cursor ?? null,
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
