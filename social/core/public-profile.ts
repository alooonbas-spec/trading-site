export type PublicProfileRef = {
  profileUrl: string;
  externalProfileId: string;
  username: string | null;
};

export function tryParseHttpUrl(source: string): URL | null {
  const trimmed = source.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return null;
  }

  try {
    return new URL(trimmed);
  } catch {
    return null;
  }
}

export function normalizedHostname(url: URL): string {
  return url.hostname.replace(/^www\./i, "").toLowerCase();
}

export function firstPathSegment(url: URL): string {
  return url.pathname.split("/").filter(Boolean)[0] ?? "";
}
