import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { ValidationError } from "@/lib/errors";
import { tryParseHttpUrl } from "@/social/core/public-profile";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.internal",
]);

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return ((parts[0] ?? 0) << 24) + ((parts[1] ?? 0) << 16) + ((parts[2] ?? 0) << 8) + (parts[3] ?? 0);
}

function inCidr(ip: string, base: string, bits: number): boolean {
  const value = ipv4ToInt(ip);
  const network = ipv4ToInt(base);
  if (value === null || network === null) {
    return false;
  }
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return ((value >>> 0) & mask) === ((network >>> 0) & mask);
}

export function isPrivateOrLocalIp(ip: string): boolean {
  const lowered = ip.toLowerCase();
  const mapped = lowered.replace(/^::ffff:/, "");
  if (
    lowered === "::1" ||
    lowered === "::" ||
    lowered.startsWith("fe80:") ||
    lowered.startsWith("fc") ||
    lowered.startsWith("fd")
  ) {
    return true;
  }
  if (isIP(mapped) !== 4) {
    return false;
  }
  return (
    inCidr(mapped, "0.0.0.0", 8) ||
    inCidr(mapped, "10.0.0.0", 8) ||
    inCidr(mapped, "127.0.0.0", 8) ||
    inCidr(mapped, "169.254.0.0", 16) ||
    inCidr(mapped, "172.16.0.0", 12) ||
    inCidr(mapped, "192.168.0.0", 16) ||
    inCidr(mapped, "100.64.0.0", 10)
  );
}

export function parsePublicMediaUrl(source: string): URL {
  const url = tryParseHttpUrl(source);
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) {
    throw new ValidationError("Media must be an http or https URL");
  }
  if (url.username || url.password) {
    throw new ValidationError("Media URLs cannot include credentials");
  }

  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host) || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new ValidationError("Media URLs cannot target local or internal hosts");
  }
  if (isIP(host) && isPrivateOrLocalIp(host)) {
    throw new ValidationError("Media URLs cannot target private IP addresses");
  }
  return url;
}

export async function assertPublicMediaHost(source: string): Promise<URL> {
  const url = parsePublicMediaUrl(source);
  if (isIP(url.hostname)) {
    return url;
  }

  const records = await lookup(url.hostname, { all: true, verbatim: true });
  if (records.length === 0 || records.some((record) => isPrivateOrLocalIp(record.address))) {
    throw new ValidationError("Media URLs cannot resolve to private IP addresses");
  }
  return url;
}
