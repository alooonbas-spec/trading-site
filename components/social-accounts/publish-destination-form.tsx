"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { idleActionState, updatePublishDestinationAction } from "@/app/actions/social-accounts";
import type { PublishDestinationKey } from "@/lib/social/publish-destination";

export function PublishDestinationForm({
  workspaceId,
  accountId,
  field,
  label,
  placeholder,
  hint,
}: {
  workspaceId: string;
  accountId: string;
  field: PublishDestinationKey;
  label: string;
  placeholder: string;
  hint: string;
}) {
  const action = updatePublishDestinationAction.bind(null, workspaceId, accountId);
  const [state, formAction, pending] = useActionState(action, idleActionState);

  return (
    <form action={formAction} className="space-y-2">
      <Label htmlFor={`${accountId}-${field}`}>{label}</Label>
      <div className="flex gap-2">
        <Input id={`${accountId}-${field}`} name={field} placeholder={placeholder} autoComplete="off" />
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          {pending ? "Saving..." : "Save"}
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">{hint}</p>
      {state.error ? <p className="text-destructive text-xs">{state.error}</p> : null}
      {state.success ? <p className="text-xs">{state.success}</p> : null}
    </form>
  );
}
