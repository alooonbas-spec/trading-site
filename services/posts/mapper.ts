import type { Post, PostTarget } from "@/types/post";
import type { PostStatus, PostTargetStatus } from "@/types/status";

type PostRow = {
  id: string;
  workspace_id: string;
  body: string;
  media: unknown;
  status: PostStatus;
  scheduled_at: string | null;
  published_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type PostTargetRow = {
  id: string;
  workspace_id: string;
  post_id: string;
  social_account_id: string;
  status: PostTargetStatus;
  external_post_id: string | null;
  published_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

function toMedia(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

export function toPost(
  row: PostRow,
  counts: { targetCount: number; publishedTargetCount: number; failedTargetCount: number } = {
    targetCount: 0,
    publishedTargetCount: 0,
    failedTargetCount: 0,
  },
): Post {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    body: row.body,
    media: toMedia(row.media),
    status: row.status,
    scheduledAt: row.scheduled_at,
    publishedAt: row.published_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...counts,
  };
}

export function toPostTarget(row: PostTargetRow): PostTarget {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    postId: row.post_id,
    socialAccountId: row.social_account_id,
    status: row.status,
    externalPostId: row.external_post_id,
    publishedAt: row.published_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
