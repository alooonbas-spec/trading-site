"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createLeadAction, idleActionState } from "@/app/actions/leads";
import { LEAD_STATUSES } from "@/types/status";

export function CreateLeadForm({ workspaceId }: { workspaceId: string }) {
  const action = createLeadAction.bind(null, workspaceId);
  const [state, formAction, pending] = useActionState(action, idleActionState);

  return (
    <form action={formAction} className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="lead-name">Name</Label>
        <Input id="lead-name" name="displayName" required maxLength={120} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="lead-status">Lead status</Label>
        <select
          id="lead-status"
          name="status"
          defaultValue="NEW"
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
        >
          {LEAD_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="lead-email">Email</Label>
        <Input id="lead-email" name="email" type="email" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="lead-phone">Phone</Label>
        <Input id="lead-phone" name="phone" />
      </div>
      <div className="space-y-2 md:col-span-2">
        <Label htmlFor="lead-notes">Notes</Label>
        <Textarea id="lead-notes" name="notes" />
      </div>
      {state.error ? <p className="text-sm text-destructive md:col-span-2">{state.error}</p> : null}
      <div className="md:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Creating..." : "Create lead"}
        </Button>
      </div>
    </form>
  );
}
