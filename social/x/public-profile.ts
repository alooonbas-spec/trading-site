import { ValidationError } from "@/lib/errors";
import {
  normalizedHostname,
  tryParseHttpUrl,
  type PublicProfileRef,
} from "@/social/core/public-profile";

const X_USERNAME = /^[A-Za-z0-9_]{1,15}$/;
const X_HOSTS = new Set(["x.com", "twitter.com", "mobile.twitter.com", "mobile.x.com"]);
const REJECTED_X_PATHS = new Set([
  "home",
  "explore",
  "search",
  "settings",
  "i",
  "intent",
  "compose",
  "messages",
  "notifications",
  "share",
  "hashtag",
  "login",
  "signup",
]);

export function resolveXPublicProfile(source: string): PublicProfileRef {
  const trimmed = source.trim();
  if (!trimmed) {
    throw new ValidationError("X username or public profile URL is required");
  }

  const url = tryParseHttpUrl(trimmed);
  let handle = trimmed.replace(/^@/, "");

  if (url) {
    const host = normalizedHostname(url);
    if (!X_HOSTS.has(host)) {
      throw new ValidationError("Only official X profile URLs are supported");
    }

    const parts = url.pathname.split("/").filter(Boolean);
    const segment = (parts[0] ?? "").replace(/^@/, "");
    if (!segment || REJECTED_X_PATHS.has(segment.toLowerCase()) || parts[1]?.toLowerCase() === "status") {
      throw new ValidationError("Only public X profile URLs are supported");
    }
    handle = segment;
  }

  if (!X_USERNAME.test(handle)) {
    throw new ValidationError("X username is invalid");
  }

  return {
    profileUrl: `https://x.com/${handle}`,
    externalProfileId: handle.toLowerCase(),
    username: `@${handle}`,
  };
}
