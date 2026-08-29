import { POST_STATUSES, type PostStatus } from "@/types/status";

export function parsePostStatusFilter(value: string | undefined): PostStatus | undefined {
  if (value && (POST_STATUSES as readonly string[]).includes(value)) {
    return value as PostStatus;
  }
  return undefined;
}
