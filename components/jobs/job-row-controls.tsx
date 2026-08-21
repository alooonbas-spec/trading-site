"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cancelQueuedJobAction, retryFailedJobAction } from "@/app/actions/jobs";

export function JobRowControls({
  workspaceId,
  jobId,
  canRetry,
  canCancel,
}: {
  workspaceId: string;
  jobId: string;
  canRetry: boolean;
  canCancel: boolean;
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

  if (!canRetry && !canCancel) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-2">
        {canRetry ? (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => retryFailedJobAction(workspaceId, jobId))}>
            Retry
          </Button>
        ) : null}
        {canCancel ? (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => cancelQueuedJobAction(workspaceId, jobId))}>
            Cancel
          </Button>
        ) : null}
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {message ? <p className="text-xs">{message}</p> : null}
    </div>
  );
}
