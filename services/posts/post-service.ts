import { createClient } from "@/lib/supabase/server";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { assertCanManageWorkspace, assertCanMutateWorkspaceData } from "@/lib/auth/permissions";
import { ValidationError } from "@/lib/errors";
import { logActivity } from "@/services/activity/activity-service";
import { createPostSchema } from "@/lib/validation/post";
import { canCancelPost, canDeletePost, canPublishPost, rollupPostStatus } from "@/lib/posts/status";
import { POST_PUBLIC_COLUMNS, POST_TARGET_PUBLIC_COLUMNS, type Post, type PostTarget } from "@/types/post";
import { toPost, toPostTarget } from "@/services/posts/mapper";
import { enqueuePublishJobs } from "@/services/jobs/enqueue-service";
import type { PostTargetStatus } from "@/types/status";

export async function listPosts(workspaceId: string): Promise<Post[]> {
  await requireWorkspaceContext(workspaceId);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("posts")
    .select(POST_PUBLIC_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new ValidationError(error.message);
  }

  return attachPostCounts(workspaceId, (data ?? []).map((row) => toPost(row)));
}

export async function getPost(workspaceId: string, postId: string): Promise<Post> {
  await requireWorkspaceContext(workspaceId);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("posts")
    .select(POST_PUBLIC_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("id", postId)
    .maybeSingle();

  if (error) {
    throw new ValidationError(error.message);
  }
  if (!data) {
    throw new ValidationError("Post not found");
  }

  const [post] = await attachPostCounts(workspaceId, [toPost(data)]);
  if (!post) {
    throw new ValidationError("Post not found");
  }
  return post;
}

export async function listPostTargets(workspaceId: string, postId: string): Promise<PostTarget[]> {
  await requireWorkspaceContext(workspaceId);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("post_targets")
    .select(POST_TARGET_PUBLIC_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("post_id", postId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new ValidationError(error.message);
  }

  return (data ?? []).map(toPostTarget);
}

export async function countPublishedPostsToday(workspaceId: string): Promise<number> {
  const supabase = await createClient();
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const { count, error } = await supabase
    .from("posts")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .in("status", ["PUBLISHED", "PARTIAL"])
    .gte("published_at", startOfDay.toISOString());

  if (error) {
    throw new Error(error.message);
  }
  return count ?? 0;
}

export async function createPost(input: {
  workspaceId: string;
  body: string;
  media: string[];
  accountIds: string[];
  scheduledAt: string | null;
}): Promise<Post> {
  const context = await requireWorkspaceContext(input.workspaceId);
  assertCanMutateWorkspaceData(context.role);
  const parsed = createPostSchema.parse({
    body: input.body,
    media: input.media,
    accountIds: input.accountIds,
    scheduledAt: input.scheduledAt,
  });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("posts")
    .insert({
      workspace_id: input.workspaceId,
      body: parsed.body,
      media: parsed.media,
      scheduled_at: parsed.scheduledAt ?? null,
      created_by: context.user.id,
    })
    .select(POST_PUBLIC_COLUMNS)
    .single();

  if (error || !data) {
    throw new ValidationError(error?.message ?? "Unable to create post");
  }

  const { error: targetError } = await supabase.from("post_targets").insert(
    parsed.accountIds.map((accountId) => ({
      workspace_id: input.workspaceId,
      post_id: data.id,
      social_account_id: accountId,
    })),
  );
  if (targetError) {
    throw new ValidationError(targetError.message);
  }

  await logActivity({
    workspaceId: input.workspaceId,
    userId: context.user.id,
    action: "POST_CREATED",
    entityType: "post",
    entityId: data.id,
  });

  return getPost(input.workspaceId, data.id);
}

export async function publishPost(input: { workspaceId: string; postId: string }): Promise<number> {
  const context = await requireWorkspaceContext(input.workspaceId);
  assertCanMutateWorkspaceData(context.role);
  const post = await getPost(input.workspaceId, input.postId);
  if (!canPublishPost(post.status)) {
    throw new ValidationError("This post cannot be published in its current status");
  }

  const supabase = await createClient();
  const scheduledAt = post.scheduledAt && new Date(post.scheduledAt).getTime() > Date.now() ? post.scheduledAt : null;
  const nextStatus = scheduledAt ? "SCHEDULED" : "PUBLISHING";
  const targetStatus: PostTargetStatus = scheduledAt ? "SCHEDULED" : "PENDING";

  const { error: postError } = await supabase
    .from("posts")
    .update({ status: nextStatus })
    .eq("id", input.postId)
    .eq("workspace_id", input.workspaceId);
  if (postError) {
    throw new ValidationError(postError.message);
  }

  const { error: targetError } = await supabase
    .from("post_targets")
    .update({ status: targetStatus, last_error: null })
    .eq("post_id", input.postId)
    .eq("workspace_id", input.workspaceId)
    .in("status", ["PENDING", "SCHEDULED", "FAILED"]);
  if (targetError) {
    throw new ValidationError(targetError.message);
  }

  return enqueuePublishJobs({
    workspaceId: input.workspaceId,
    postId: input.postId,
    runAfter: scheduledAt,
  });
}

export async function cancelPost(input: { workspaceId: string; postId: string }): Promise<void> {
  const context = await requireWorkspaceContext(input.workspaceId);
  assertCanMutateWorkspaceData(context.role);
  const post = await getPost(input.workspaceId, input.postId);
  if (!canCancelPost(post.status)) {
    throw new ValidationError("This post cannot be cancelled in its current status");
  }

  const supabase = await createClient();
  const { error: postError } = await supabase
    .from("posts")
    .update({ status: "CANCELLED" })
    .eq("id", input.postId)
    .eq("workspace_id", input.workspaceId);
  if (postError) {
    throw new ValidationError(postError.message);
  }

  const { error: targetError } = await supabase
    .from("post_targets")
    .update({ status: "CANCELLED" })
    .eq("post_id", input.postId)
    .in("status", ["PENDING", "SCHEDULED", "PUBLISHING"]);
  if (targetError) {
    throw new ValidationError(targetError.message);
  }

  const { error: jobError } = await supabase
    .from("jobs")
    .update({ status: "CANCELLED", locked_at: null, locked_by: null, completed_at: new Date().toISOString() })
    .eq("post_id", input.postId)
    .in("status", ["PENDING", "RETRY", "RUNNING"]);
  if (jobError) {
    throw new ValidationError(jobError.message);
  }
}

export async function deletePost(input: { workspaceId: string; postId: string }): Promise<void> {
  const context = await requireWorkspaceContext(input.workspaceId);
  assertCanManageWorkspace(context.role);
  const post = await getPost(input.workspaceId, input.postId);
  if (!canDeletePost(post.status)) {
    throw new ValidationError("A post cannot be deleted while it is publishing");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("posts").delete().eq("id", input.postId).eq("workspace_id", input.workspaceId);
  if (error) {
    throw new ValidationError(error.message);
  }
}

export async function refreshPostRollup(workspaceId: string, postId: string): Promise<void> {
  const supabase = await createClient();
  const { data, error: targetError } = await supabase
    .from("post_targets")
    .select(POST_TARGET_PUBLIC_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("post_id", postId)
    .order("created_at", { ascending: true });
  if (targetError) {
    throw new ValidationError(targetError.message);
  }

  const targets = (data ?? []).map(toPostTarget);
  const status = rollupPostStatus(targets.map((target) => target.status));
  const publishedAt =
    status === "PUBLISHED" || status === "PARTIAL"
      ? (targets.find((target) => target.publishedAt)?.publishedAt ?? new Date().toISOString())
      : null;

  const { error } = await supabase
    .from("posts")
    .update({
      status,
      published_at: publishedAt,
    })
    .eq("id", postId)
    .eq("workspace_id", workspaceId)
    .neq("status", "CANCELLED");
  if (error) {
    throw new ValidationError(error.message);
  }
}

async function attachPostCounts(workspaceId: string, posts: Post[]): Promise<Post[]> {
  if (posts.length === 0) {
    return posts;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("post_targets")
    .select("post_id, status")
    .eq("workspace_id", workspaceId)
    .in(
      "post_id",
      posts.map((post) => post.id),
    );
  if (error) {
    throw new ValidationError(error.message);
  }

  const counts = new Map<string, { targetCount: number; publishedTargetCount: number; failedTargetCount: number }>();
  for (const row of data ?? []) {
    const current = counts.get(row.post_id) ?? { targetCount: 0, publishedTargetCount: 0, failedTargetCount: 0 };
    current.targetCount += 1;
    if (row.status === "PUBLISHED") {
      current.publishedTargetCount += 1;
    }
    if (row.status === "FAILED" || row.status === "SKIPPED") {
      current.failedTargetCount += 1;
    }
    counts.set(row.post_id, current);
  }

  return posts.map((post) => ({
    ...post,
    ...(counts.get(post.id) ?? { targetCount: 0, publishedTargetCount: 0, failedTargetCount: 0 }),
  }));
}
