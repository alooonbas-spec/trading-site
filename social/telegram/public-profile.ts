import { ValidationError } from "@/lib/errors";
import {
  firstPathSegment,
  normalizedHostname,
  tryParseHttpUrl,
  type PublicProfileRef,
} from "@/social/core/public-profile";

const TELEGRAM_USERNAME = /^[A-Za-z0-9_]{5,32}$/;
const TELEGRAM_HOSTS = new Set(["t.me", "telegram.me", "telegram.dog"]);
const REJECTED_TELEGRAM_PATHS = new Set(["joinchat", "s", "c", "share", "proxy", "addstickers", "socks"]);

export function resolveTelegramPublicProfile(source: string): PublicProfileRef {
  const trimmed = source.trim();
  if (!trimmed) {
    throw new ValidationError("Telegram username or public profile URL is required");
  }

  const url = tryParseHttpUrl(trimmed);
  let handle = trimmed.replace(/^@/, "");

  if (url) {
    const host = normalizedHostname(url);
    if (!TELEGRAM_HOSTS.has(host)) {
      throw new ValidationError("Only official Telegram profile URLs are supported");
    }

    const segment = firstPathSegment(url).replace(/^@/, "");
    const lowered = segment.toLowerCase();
    if (!segment || segment.startsWith("+") || REJECTED_TELEGRAM_PATHS.has(lowered)) {
      throw new ValidationError("Only public Telegram username URLs are supported");
    }
    handle = segment;
  }

  if (!TELEGRAM_USERNAME.test(handle)) {
    throw new ValidationError("Telegram username is invalid");
  }

  return {
    profileUrl: `https://t.me/${handle}`,
    externalProfileId: handle.toLowerCase(),
    username: `@${handle}`,
  };
}
