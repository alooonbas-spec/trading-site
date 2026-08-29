"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { addNoteAction, idleActionState } from "@/app/actions/leads";
import type { LeadInteraction } from "@/types/crm";

export function InteractionTimeline({
  workspaceId,
  leadId,
  interactions,
  canMutate,
}: {
  workspaceId: string;
  leadId: string;
  interactions: LeadInteraction[];
  canMutate: boolean;
}) {
  const action = addNoteAction.bind(null, workspaceId, leadId);
  const [state, formAction, pending] = useActionState(action, idleActionState);

  return (
    <div className="space-y-4">
      {canMutate ? (
        <form action={formAction} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="note-body">Add note</Label>
            <Textarea id="note-body" name="body" required />
          </div>
          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
          <Button type="submit" disabled={pending}>
            {pending ? "Saving..." : "Add note"}
          </Button>
        </form>
      ) : null}
      {interactions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No interactions yet.</p>
      ) : (
        <ol className="space-y-3">
          {interactions.map((item) => (
            <li key={item.id} className="rounded-lg border border-border px-3 py-2">
              <p className="text-xs text-muted-foreground">
                {item.type} · {new Date(item.createdAt).toLocaleString()}
              </p>
              <p className="mt-1 text-sm">{item.body ?? "—"}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
