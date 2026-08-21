export type NamedInboxCursor = Record<string, string>;

export function parseNamedInboxCursor(cursor: string | null | undefined): NamedInboxCursor {
  const value = cursor?.trim();
  if (!value || !isNamedInboxCursor(value)) {
    return {};
  }

  const parsed: NamedInboxCursor = {};
  for (const part of value.split("|")) {
    const separator = part.indexOf(":");
    if (separator <= 0) {
      continue;
    }
    const key = part.slice(0, separator).trim();
    const partValue = part.slice(separator + 1).trim();
    if (key && partValue) {
      parsed[key] = partValue;
    }
  }
  return parsed;
}

export function serializeNamedInboxCursor(parts: NamedInboxCursor): string | null {
  const entries = Object.entries(parts)
    .filter(([, value]) => value.trim().length > 0)
    .sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) {
    return null;
  }
  return entries.map(([key, value]) => `${key}:${value}`).join("|");
}

export function isNamedInboxCursor(cursor: string): boolean {
  return cursor.includes("|") || /^[a-z][a-z0-9_]*:/i.test(cursor);
}

export function isDigitIdAfter(id: string, cursor: string | null | undefined): boolean {
  const watermark = cursor?.trim() || null;
  if (!watermark) {
    return true;
  }
  if (!/^\d+$/.test(id) || !/^\d+$/.test(watermark)) {
    return true;
  }
  return BigInt(id) > BigInt(watermark);
}

export function laterDigitId(left: string | null | undefined, right: string | null | undefined): string | null {
  const start = left?.trim() || null;
  const next = right?.trim() || null;
  if (!start) {
    return next;
  }
  if (!next) {
    return start;
  }
  if (/^-?\d+$/.test(start) && /^-?\d+$/.test(next)) {
    return BigInt(next) > BigInt(start) ? next : start;
  }
  return start;
}

export function parseInboxTimestampMs(value: string | null | undefined): number | null {
  const raw = value?.trim();
  if (!raw) {
    return null;
  }
  if (/^\d{10}$/.test(raw)) {
    return Number(raw) * 1000;
  }
  const normalized = raw.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

export function laterTimestampString(left: string | null | undefined, right: string | null | undefined): string | null {
  const start = left?.trim() || null;
  const next = right?.trim() || null;
  if (!start) {
    return next;
  }
  if (!next) {
    return start;
  }
  const startMs = parseInboxTimestampMs(start);
  const nextMs = parseInboxTimestampMs(next);
  if (startMs === null || nextMs === null) {
    return next;
  }
  return nextMs > startMs ? next : start;
}

export function laterNamedValue(left: string | null | undefined, right: string | null | undefined): string | null {
  const start = left?.trim() || null;
  const next = right?.trim() || null;
  if (!start) {
    return next;
  }
  if (!next) {
    return start;
  }
  if (/^-?\d+$/.test(start) && /^-?\d+$/.test(next)) {
    return laterDigitId(start, next);
  }
  const startMs = parseInboxTimestampMs(start);
  const nextMs = parseInboxTimestampMs(next);
  if (startMs !== null && nextMs !== null) {
    return nextMs > startMs ? next : start;
  }
  return next;
}

export function laterNamedInboxCursor(left: string | null, right: string | null): string | null {
  const start = parseNamedInboxCursor(left);
  const next = parseNamedInboxCursor(right);
  const merged: NamedInboxCursor = {};
  for (const key of new Set([...Object.keys(start), ...Object.keys(next)])) {
    const value = laterNamedValue(start[key] ?? null, next[key] ?? null);
    if (value) {
      merged[key] = value;
    }
  }
  return serializeNamedInboxCursor(merged);
}

export function isReceivedAfterCursor(receivedAt: string | null, cursor: string | null | undefined): boolean {
  if (!cursor) {
    return true;
  }
  if (!receivedAt) {
    return true;
  }
  const receivedMs = parseInboxTimestampMs(receivedAt);
  const cursorMs = parseInboxTimestampMs(cursor);
  if (receivedMs === null || cursorMs === null) {
    return true;
  }
  return receivedMs > cursorMs;
}

export function filterMessagesAfterCursor<T extends { receivedAt: string | null }>(
  messages: T[],
  cursor: string | null | undefined,
): T[] {
  if (!cursor) {
    return messages;
  }
  return messages.filter((message) => isReceivedAfterCursor(message.receivedAt, cursor));
}

export function newestReceivedAt(messages: Array<{ receivedAt: string | null }>): string | null {
  return messages.reduce<string | null>(
    (newest, message) => laterTimestampString(newest, message.receivedAt),
    null,
  );
}

export function uniqueInboxMessages<T extends { externalId: string }>(messages: T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const message of messages) {
    if (seen.has(message.externalId)) {
      continue;
    }
    seen.add(message.externalId);
    unique.push(message);
  }
  return unique;
}
