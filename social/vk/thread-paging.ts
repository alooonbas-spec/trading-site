import { z } from "zod";

export const VK_THREAD_PAGE_DONE = "done";
export const VK_THREAD_FETCH_LIMIT = 20;
export const VK_THREAD_ID = /^-?\d+_\d+_\d+$/;

export type VkThreadMap = Record<string, string>;

export function encodeVkThreadMap(map: VkThreadMap): string {
  const entries = Object.entries(map).filter(([id, page]) => VK_THREAD_ID.test(id) && /^\d+$/.test(page) && page !== "0");
  if (entries.length === 0) {
    return VK_THREAD_PAGE_DONE;
  }
  entries.sort(([left], [right]) => left.localeCompare(right));
  return Buffer.from(JSON.stringify(Object.fromEntries(entries.slice(0, VK_THREAD_FETCH_LIMIT))), "utf8").toString(
    "base64url",
  );
}

export function decodeVkThreadMap(value: string | undefined): VkThreadMap | null {
  if (!value || value === VK_THREAD_PAGE_DONE) {
    return null;
  }
  try {
    const json = Buffer.from(value, "base64url").toString("utf8").trim();
    const parsed = z.record(z.string(), z.string().min(1)).safeParse(JSON.parse(json) as unknown);
    if (!parsed.success) {
      return null;
    }
    const map: VkThreadMap = {};
    for (const [id, page] of Object.entries(parsed.data)) {
      if (VK_THREAD_ID.test(id) && /^\d+$/.test(page) && page !== "0") {
        map[id] = page;
      }
    }
    return Object.keys(map).length > 0 ? map : null;
  } catch {
    return null;
  }
}

export function parseVkThreadId(id: string): { ownerId: string; postId: string; commentId: string } | null {
  const match = /^(-?\d+)_(\d+)_(\d+)$/.exec(id);
  const ownerId = match?.[1];
  const postId = match?.[2];
  const commentId = match?.[3];
  if (!ownerId || !postId || !commentId) {
    return null;
  }
  return { ownerId, postId, commentId };
}

export function nextVkThreadCursor(input: {
  stored?: string;
  nestedAfters: VkThreadMap;
  fetchedNextAfters: VkThreadMap;
  fetchedIds: string[];
}): string {
  if (input.stored === VK_THREAD_PAGE_DONE) {
    return VK_THREAD_PAGE_DONE;
  }
  const stored = decodeVkThreadMap(input.stored);
  if (!stored) {
    return encodeVkThreadMap(input.nestedAfters);
  }
  const fetched = new Set(input.fetchedIds);
  const next: VkThreadMap = { ...input.fetchedNextAfters };
  for (const [id, page] of Object.entries(stored)) {
    if (!fetched.has(id)) {
      next[id] = page;
    }
  }
  for (const [id, page] of Object.entries(input.nestedAfters)) {
    if (!fetched.has(id) && stored[id] === undefined) {
      next[id] = page;
    }
  }
  return encodeVkThreadMap(next);
}
