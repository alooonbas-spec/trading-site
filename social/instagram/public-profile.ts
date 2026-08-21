import { ValidationError } from "@/lib/errors";
import {
  firstPathSegment,
  normalizedHostname,
  tryParseHttpUrl,
  type PublicProfileRef,
} from "@/social/core/public-profile";

const INSTAGRAM_USERNAME = /^[A-Za-z0-9._]{1,30}$/;
const INSTAGRAM_HOSTS = new Set(["instagram.com", "m.instagram.com"]);
const REJECTED_INSTAGRAM_PATHS = new Set([
  "p",
  "reel",
  "reels",
  "stories",
  "explore",
  "accounts",
  "direct",
  "tv",
  "login",
  "about",
]);

export function resolveInstagramPublicProfile(source: string): PublicProfileRef {
  const trimmed = source.trim();
  if (!trimmed) {
    throw new ValidationError("Instagram username or public profile URL is required");
  }

  const url = tryParseHttpUrl(trimmed);
  let handle = trimmed.replace(/^@/, "");

  if (url) {
    const host = normalizedHostname(url);
    if (!INSTAGRAM_HOSTS.has(host)) {
      throw new ValidationError("Only official Instagram profile URLs are supported");
    }

    const segment = firstPathSegment(url).replace(/^@/, "");
    if (!segment || REJECTED_INSTAGRAM_PATHS.has(segment.toLowerCase())) {
      throw new ValidationError("Only public Instagram profile URLs are supported");
    }
    handle = segment;
  }

  if (!INSTAGRAM_USERNAME.test(handle)) {
    throw new ValidationError("Instagram username is invalid");
  }

  return {
    profileUrl: `https://www.instagram.com/${handle}/`,
    externalProfileId: handle.toLowerCase(),
    username: `@${handle}`,
  };
}
