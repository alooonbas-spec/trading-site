import { ValidationError } from "@/lib/errors";
import {
  firstPathSegment,
  normalizedHostname,
  tryParseHttpUrl,
  type PublicProfileRef,
} from "@/social/core/public-profile";

const FACEBOOK_USERNAME = /^[A-Za-z0-9.]{3,50}$/;
const FACEBOOK_HOSTS = new Set(["facebook.com", "fb.com", "m.facebook.com"]);
const REJECTED_FACEBOOK_PATHS = new Set([
  "watch",
  "events",
  "groups",
  "marketplace",
  "login",
  "share.php",
  "dialog",
  "sharer",
  "permalink.php",
  "photo.php",
  "story.php",
  "pages",
  "people",
]);

export function resolveFacebookPublicProfile(source: string): PublicProfileRef {
  const trimmed = source.trim();
  if (!trimmed) {
    throw new ValidationError("Facebook id or public profile URL is required");
  }

  const url = tryParseHttpUrl(trimmed);
  let handle = trimmed.replace(/^@/, "");

  if (url) {
    const host = normalizedHostname(url);
    if (!FACEBOOK_HOSTS.has(host)) {
      throw new ValidationError("Only official Facebook profile URLs are supported");
    }

    const profileId = url.searchParams.get("id");
    const path = url.pathname.replace(/\/+$/, "");
    if ((path === "/profile.php" || path.endsWith("/profile.php")) && profileId && /^\d+$/.test(profileId)) {
      handle = profileId;
    } else {
      const segment = firstPathSegment(url);
      if (!segment || REJECTED_FACEBOOK_PATHS.has(segment.toLowerCase())) {
        throw new ValidationError("Only public Facebook profile URLs are supported");
      }
      handle = segment;
    }
  }

  if (/^\d+$/.test(handle)) {
    return {
      profileUrl: `https://www.facebook.com/${handle}`,
      externalProfileId: handle,
      username: null,
    };
  }

  if (!FACEBOOK_USERNAME.test(handle)) {
    throw new ValidationError("Facebook username is invalid");
  }

  return {
    profileUrl: `https://www.facebook.com/${handle}`,
    externalProfileId: handle.toLowerCase(),
    username: handle,
  };
}
