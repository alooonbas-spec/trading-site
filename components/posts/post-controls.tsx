"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  cancelPostAction,
  deletePostAction,
  processPublishQueueAction,
  publishPostAction,
} from "@/app/actions/posts";
import { canCancelPost, canDeletePost, canPublishPost } from "@/lib/posts/status";
import type { Post } from "@/types/post";

export function PostControls({
  workspaceId,
  post,
  canMutate,
  canDelete,
}: {
  workspaceId: string;
  post: Post;
  canMutate: boolean;
  canDelete: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<{ error: string | null; success: string | null }>) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) {
        setError(result.error);
        return;
      }
      setMessage(result.success);
    });
  }

  if (!canMutate) {
    return <p className="text-sm text-muted-foreground">This role cannot publish posts.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {canPublishPost(post.status) ? (
          <Button size="sm" disabled={pending} onClick={() => run(() => publishPostAction(workspaceId, post.id))}>
            {post.scheduledAt ? "Queue scheduled publish" : "Publish"}
          </Button>
        ) : null}
        {canCancelPost(post.status) ? (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => run(() => cancelPostAction(workspaceId, post.id))}
          >
            Cancel
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() => run(() => processPublishQueueAction(workspaceId, post.id))}
        >
          Process queue
        </Button>
        {canDelete && canDeletePost(post.status) ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => run(() => deletePostAction(workspaceId, post.id))}
          >
            Delete
          </Button>
        ) : null}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {message ? <p className="text-sm">{message}</p> : null}
    </div>
  );
}
