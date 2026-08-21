import type { PostStatus, PostTargetStatus } from "@/types/status";

export type Post = {
  id: string;
  workspaceId: string;
  body: string;
  media: string[];
  status: PostStatus;
  scheduledAt: string | null;
  publishedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  targetCount: number;
  publishedTargetCount: number;
  failedTargetCount: number;
};

export type PostTarget = {
  id: string;
  workspaceId: string;
  postId: string;
  socialAccountId: string;
  status: PostTargetStatus;
  externalPostId: string | null;
  publishedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export const POST_PUBLIC_COLUMNS =
  "id, workspace_id, body, media, status, scheduled_at, published_at, created_by, created_at, updated_at" as const;

export const POST_TARGET_PUBLIC_COLUMNS =
  "id, workspace_id, post_id, social_account_id, status, external_post_id, published_at, last_error, created_at, updated_at" as const;
