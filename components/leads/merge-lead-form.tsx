"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { idleActionState, mergeLeadAction } from "@/app/actions/leads";
import type { Lead } from "@/types/crm";
import type { PickerLead } from "@/lib/leads/picker";

export function MergeLeadForm({
  workspaceId,
  targetLead,
  candidates,
}: {
  workspaceId: string;
  targetLead: Lead;
  candidates: PickerLead[];
}) {
  const action = mergeLeadAction.bind(null, workspaceId, targetLead.id);
  const [state, formAction, pending] = useActionState(action, idleActionState);

  if (candidates.length === 0) {
    return <p className="text-sm text-muted-foreground">No other active leads to merge from.</p>;
  }

  return (
    <form action={formAction} className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="merge-source">Merge this lead into {targetLead.displayName}</Label>
        <select
          id="merge-source"
          name="sourceLeadId"
          required
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
        >
          {candidates.map((lead) => (
            <option key={lead.id} value={lead.id}>
              {lead.displayName}
              {lead.email ? ` · ${lead.email}` : ""}
            </option>
          ))}
        </select>
      </div>
      <p className="text-xs text-muted-foreground">
        Profiles, relationships, interactions, and matched inbox events move to this lead. If either
        lead is marked do not contact, the surviving lead keeps that flag.
      </p>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.success ? <p className="text-sm">{state.success}</p> : null}
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Merging..." : "Merge into this lead"}
      </Button>
    </form>
  );
}
