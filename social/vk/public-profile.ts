import { ValidationError } from "@/lib/errors";
import {
  firstPathSegment,
  normalizedHostname,
  tryParseHttpUrl,
  type PublicProfileRef,
} from "@/social/core/public-profile";

const VK_SCREEN_NAME = /^(?:id\d+|[A-Za-z0-9_.]{3,32})$/;
const VK_HOSTS = new Set(["vk.com", "vk.ru", "m.vk.com", "m.vk.ru"]);
const REJECTED_VK_PATHS = new Set([
  "feed",
  "im",
  "login",
  "settings",
  "support",
  "join",
  "apps",
  "music",
  "video",
  "ads",
  "search",
  "mail",
]);
// VK's own content permalinks are a reserved word directly followed by
// <ownerId>_<itemId> (owner id negative for a community, e.g. wall-1_2),
// not a screen name -- REJECTED_VK_PATHS above only matches the bare word,
// so "wall123_456" slips past it as if it were a valid screen name.
const VK_PERMALINK_PATTERN = /^(?:wall|photo|video|board|market|album|docs|audio|clip)-?\d+_\d+$/i;

function canonicalizeVkId(handle: string): { externalProfileId: string; path: string } {
  const match = /^id(\d+)$/i.exec(handle);
  if (match?.[1]) {
    return { externalProfileId: match[1], path: match[1] };
  }

  if (/^\d+$/.test(handle)) {
    return { externalProfileId: handle, path: handle };
  }

  return { externalProfileId: handle.toLowerCase(), path: handle };
}

export function resolveVkPublicProfile(source: string): PublicProfileRef {
  const trimmed = source.trim();
  if (!trimmed) {
    throw new ValidationError("VK id or public profile URL is required");
  }

  const url = tryParseHttpUrl(trimmed);
  let handle = trimmed.replace(/^@/, "");

  if (url) {
    const host = normalizedHostname(url);
    if (!VK_HOSTS.has(host)) {
      throw new ValidationError("Only official VK profile URLs are supported");
    }

    const segment = firstPathSegment(url);
    if (!segment || REJECTED_VK_PATHS.has(segment.toLowerCase()) || VK_PERMALINK_PATTERN.test(segment)) {
      throw new ValidationError("Only public VK profile URLs are supported");
    }
    handle = segment;
  }

  if (!VK_SCREEN_NAME.test(handle) && !/^\d+$/.test(handle)) {
    throw new ValidationError("VK id or screen name is invalid");
  }

  const canonical = canonicalizeVkId(handle);
  return {
    profileUrl: `https://vk.com/${canonical.path}`,
    externalProfileId: canonical.externalProfileId,
    username: canonical.path,
  };
}
