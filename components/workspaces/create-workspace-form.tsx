"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createWorkspaceAction,
  idleActionState,
  type ActionState,
} from "@/app/actions/workspace";

export function CreateWorkspaceForm({
  action = createWorkspaceAction,
  submitLabel = "Create workspace",
}: {
  action?: (state: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, idleActionState);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Workspace name</Label>
        <Input id="name" name="name" placeholder="Trading" required minLength={2} maxLength={80} />
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Creating..." : submitLabel}
      </Button>
    </form>
  );
}
