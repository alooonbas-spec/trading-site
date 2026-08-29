"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  cancelCampaignAction,
  deleteCampaignAction,
  pauseCampaignAction,
  processQueueAction,
  startCampaignAction,
} from "@/app/actions/campaigns";
import type { Campaign } from "@/types/campaign";

export function CampaignControls({
  workspaceId,
  campaign,
  canMutate,
  canDelete,
}: {
  workspaceId: string;
  campaign: Campaign;
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
    return <p className="text-sm text-muted-foreground">This role cannot run campaigns.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={pending}
          onClick={() => run(() => startCampaignAction(workspaceId, campaign.id))}
        >
          Start
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => run(() => pauseCampaignAction(workspaceId, campaign.id))}
        >
          Pause
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => run(() => cancelCampaignAction(workspaceId, campaign.id))}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() => run(() => processQueueAction(workspaceId, campaign.id))}
        >
          Process queue
        </Button>
        {canDelete ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => run(() => deleteCampaignAction(workspaceId, campaign.id))}
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
