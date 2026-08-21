"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { deleteWorkspaceAction } from "@/app/actions/workspace";

export function DeleteWorkspaceButton({ workspaceId }: { workspaceId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onDelete() {
    const confirmed = window.confirm("Delete this workspace and all of its data?");
    if (!confirmed) {
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await deleteWorkspaceAction(workspaceId);
      if (result.error) {
        setError(result.error);
      }
    });
  }

  return (
    <div className="space-y-2">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button variant="destructive" disabled={pending} onClick={onDelete}>
        {pending ? "Deleting..." : "Delete workspace"}
      </Button>
    </div>
  );
}
