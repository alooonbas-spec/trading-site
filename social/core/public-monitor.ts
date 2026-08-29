import { ValidationError } from "@/lib/errors";
import { matchKeywords, normalizeKeywords } from "@/lib/monitoring/keywords";
import { searchPublicContents } from "@/lib/tinyfish/client";
import type { MonitorResult } from "@/social/core/adapter";
import {
  MONITOR_SEARCH_DOMAINS,
  assertMonitorSourcesAllowed,
} from "@/social/core/monitor-sources";
import type { SocialPlatform } from "@/types/social";

export async function searchPublicMentions(input: {
  platform: SocialPlatform;
  keywords: string[];
  sources: string[];
}): Promise<MonitorResult> {
  const keywords = normalizeKeywords(input.keywords);
  if (keywords.length === 0) {
    throw new ValidationError("Monitoring requires at least one keyword");
  }

  assertMonitorSourcesAllowed(input.platform, input.sources);

  const payload = await searchPublicContents({
    query: keywords.join(" "),
    includeDomains: [...MONITOR_SEARCH_DOMAINS[input.platform]],
  });

  const events = [];
  for (const result of payload.results) {
    const content = [result.title, result.snippet].filter(Boolean).join("\n");
    const matchedKeywords = matchKeywords(`${content}\n${result.url}`, keywords);
    if (matchedKeywords.length === 0) {
      continue;
    }

    events.push({
      externalId: result.url,
      author: result.domain ?? null,
      content: content || result.url,
      url: result.url,
      matchedKeywords,
    });
  }

  return { events };
}
