"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { attachInboxEventAction, idleActionState } from "@/app/actions/inbox";
import type { Lead } from "@/types/crm";

export function AttachInboxForm({
  workspaceId,
  inboxEventId,
  leads,
}: {
  workspaceId: string;
  inboxEventId: string;
  leads: Lead[];
}) {
  const action = attachInboxEventAction.bind(null, workspaceId, inboxEventId);
  const [state, formAction, pending] = useActionState(action, idleActionState);

  if (leads.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Create a lead first. Inbox never auto-creates people.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <div className="min-w-0 flex-1 space-y-1">
        <Label htmlFor={`inbox-lead-${inboxEventId}`} className="sr-only">
          Existing lead
        </Label>
        <select
          id={`inbox-lead-${inboxEventId}`}
          name="leadId"
          required
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
        >
          {leads.map((lead) => (
            <option key={lead.id} value={lead.id}>
              {lead.displayName}
              {lead.email ? ` · ${lead.email}` : ""}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Attaching..." : "Attach"}
      </Button>
      {state.error ? <p className="text-xs text-destructive sm:col-span-2">{state.error}</p> : null}
      {state.success ? <p className="text-xs text-muted-foreground sm:col-span-2">{state.success}</p> : null}
    </form>
  );
}
