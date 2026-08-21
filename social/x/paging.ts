export const X_PAGE_DONE = "done";

export function encodeXPageToken(token: string): string {
  return Buffer.from(token, "utf8").toString("base64url");
}

export function decodeXPageToken(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw || raw === X_PAGE_DONE) {
    return null;
  }
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8").trim();
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

export function nextXPageCursor(input: {
  stored?: string;
  firstPageToken: string | null;
  olderPageToken: string | null;
  fetchedOlder: boolean;
}): string {
  if (input.stored === X_PAGE_DONE) {
    return X_PAGE_DONE;
  }
  if (!input.fetchedOlder) {
    return input.firstPageToken ? encodeXPageToken(input.firstPageToken) : X_PAGE_DONE;
  }
  return input.olderPageToken ? encodeXPageToken(input.olderPageToken) : X_PAGE_DONE;
}
