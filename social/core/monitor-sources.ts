import { ValidationError } from "@/lib/errors";
import { normalizedHostname, tryParseHttpUrl } from "@/social/core/public-profile";
import type { SocialPlatform } from "@/types/social";

export const MONITOR_SEARCH_DOMAINS: Record<SocialPlatform, readonly string[]> = {
  telegram: ["t.me"],
  vk: ["vk.com"],
  x: ["x.com", "twitter.com"],
  instagram: ["instagram.com"],
  facebook: ["facebook.com"],
};

const MONITOR_ALLOWED_HOSTS: Record<SocialPlatform, ReadonlySet<string>> = {
  telegram: new Set(["t.me", "telegram.me", "telegram.dog"]),
  vk: new Set(["vk.com", "vk.ru", "m.vk.com", "m.vk.ru"]),
  x: new Set(["x.com", "twitter.com", "mobile.twitter.com", "mobile.x.com"]),
  instagram: new Set(["instagram.com", "m.instagram.com"]),
  facebook: new Set(["facebook.com", "fb.com", "m.facebook.com"]),
};

function sourceHostname(source: string): string | null {
  const trimmed = source.trim();
  if (!trimmed) {
    return null;
  }

  const url = tryParseHttpUrl(trimmed) ?? tryParseHttpUrl(`https://${trimmed}`);
  if (!url) {
    return null;
  }

  return normalizedHostname(url);
}

export function isOfficialMonitorHost(platform: SocialPlatform, host: string): boolean {
  return MONITOR_ALLOWED_HOSTS[platform].has(host);
}

export function assertMonitorSourcesAllowed(platform: SocialPlatform, sources: string[]): void {
  for (const source of sources) {
    const host = sourceHostname(source);
    if (!host || !isOfficialMonitorHost(platform, host)) {
      throw new ValidationError(`Only official ${platform} sources are allowed`);
    }
  }
}
