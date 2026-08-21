"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  idleActionState,
  updateWorkspaceAction,
} from "@/app/actions/workspace";

export function WorkspaceSettingsForm({
  workspaceId,
  currentName,
  canEdit,
}: {
  workspaceId: string;
  currentName: string;
  canEdit: boolean;
}) {
  const action = updateWorkspaceAction.bind(null, workspaceId);
  const [state, formAction, pending] = useActionState(action, idleActionState);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="workspace-name">Name</Label>
        <Input
          id="workspace-name"
          name="name"
          defaultValue={currentName}
          required
          minLength={2}
          maxLength={80}
          disabled={!canEdit || pending}
        />
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.success ? <p className="text-sm text-foreground">{state.success}</p> : null}
      {canEdit ? (
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : "Save changes"}
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">Only owners and admins can rename a workspace.</p>
      )}
    </form>
  );
}
