"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { processInboxQueueAction } from "@/app/actions/inbox";
import { startWorkspaceInboxPollingAction } from "@/app/actions/social-accounts";

export function InboxControls({
  workspaceId,
  accountId,
  canManage,
  canMutate,
}: {
  workspaceId: string;
  accountId?: string;
  canManage: boolean;
  canMutate: boolean;
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

  if (!canManage && !canMutate) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {canManage ? (
          <Button
            size="sm"
            disabled={pending}
            onClick={() => run(() => startWorkspaceInboxPollingAction(workspaceId, accountId))}
          >
            {accountId ? "Poll this account" : "Poll inbox"}
          </Button>
        ) : null}
        {canMutate ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => run(() => processInboxQueueAction(workspaceId))}
          >
            Process queue
          </Button>
        ) : null}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {message ? <p className="text-sm">{message}</p> : null}
      <p className="text-xs text-muted-foreground">
        Poll enqueues INBOX jobs for connected accounts with inbox collection. Process queue claims
        PENDING and RETRY jobs on the shared workspace queue with SKIP LOCKED, not only INBOX jobs.
      </p>
    </div>
  );
}
