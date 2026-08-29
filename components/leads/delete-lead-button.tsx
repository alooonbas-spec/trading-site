"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { deleteLeadAction } from "@/app/actions/leads";

export function DeleteLeadButton({ workspaceId, leadId }: { workspaceId: string; leadId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button
        variant="ghost"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await deleteLeadAction(workspaceId, leadId);
            if (result?.error) {
              setError(result.error);
            }
          });
        }}
      >
        {pending ? "Deleting..." : "Delete lead"}
      </Button>
    </div>
  );
}
