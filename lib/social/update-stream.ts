export function updateStreamCursorFromMetadata(metadata?: Record<string, unknown>): string | null {
  const shared = metadata?.updateStreamCursor;
  if (typeof shared === "string" && shared.trim()) {
    return shared.trim();
  }

  const inbox = metadata?.inboxCursor;
  if (typeof inbox === "string" && inbox.trim()) {
    return inbox.trim();
  }

  return null;
}

export function laterUpdateStreamCursor(left: string | null, right: string | null): string | null {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  if (/^-?\d+$/.test(left) && /^-?\d+$/.test(right)) {
    return Number(right) > Number(left) ? right : left;
  }
  return right;
}

export function withUpdateStreamCursor(
  metadata: Record<string, unknown>,
  cursor: string | null | undefined,
): Record<string, unknown> {
  if (!cursor) {
    return metadata;
  }

  return {
    ...metadata,
    updateStreamCursor: cursor,
    inboxCursor: cursor,
  };
}
