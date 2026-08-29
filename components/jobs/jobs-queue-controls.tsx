"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { processWorkspaceQueueAction } from "@/app/actions/jobs";

export function JobsQueueControls({
  workspaceId,
  canMutate,
}: {
  workspaceId: string;
  canMutate: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!canMutate) {
    return <p className="text-sm text-muted-foreground">This role cannot process the job queue.</p>;
  }

  return (
    <div className="space-y-3">
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() => {
          setError(null);
          setMessage(null);
          startTransition(async () => {
            const result = await processWorkspaceQueueAction(workspaceId);
            if (result.error) {
              setError(result.error);
              return;
            }
            setMessage(result.success);
          });
        }}
      >
        Process queue
      </Button>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {message ? <p className="text-sm">{message}</p> : null}
      <p className="text-xs text-muted-foreground">
        Process queue claims PENDING and RETRY jobs on the shared workspace queue with SKIP LOCKED.
        Retry puts a FAILED job back to PENDING with attempts reset. Cancel only affects PENDING and
        RETRY jobs.
      </p>
    </div>
  );
}
