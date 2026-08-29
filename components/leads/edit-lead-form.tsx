"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { idleActionState, updateLeadAction } from "@/app/actions/leads";
import { LEAD_STATUSES } from "@/types/status";
import type { Lead } from "@/types/crm";

export function EditLeadForm({ workspaceId, lead }: { workspaceId: string; lead: Lead }) {
  const action = updateLeadAction.bind(null, workspaceId, lead.id);
  const [state, formAction, pending] = useActionState(action, idleActionState);

  return (
    <form action={formAction} className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="edit-name">Name</Label>
        <Input id="edit-name" name="displayName" defaultValue={lead.displayName} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="edit-status">Lead status</Label>
        <select
          id="edit-status"
          name="status"
          defaultValue={lead.status}
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
        <Label htmlFor="edit-email">Email</Label>
        <Input id="edit-email" name="email" type="email" defaultValue={lead.email ?? ""} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="edit-phone">Phone</Label>
        <Input id="edit-phone" name="phone" defaultValue={lead.phone ?? ""} />
      </div>
      <div className="space-y-2 md:col-span-2">
        <Label htmlFor="edit-notes">Notes</Label>
        <Textarea id="edit-notes" name="notes" defaultValue={lead.notes ?? ""} />
      </div>
      <label className="flex items-center gap-2 text-sm md:col-span-2">
        <input
          type="checkbox"
          name="doNotContact"
          defaultChecked={lead.doNotContact}
          className="size-4 accent-primary"
        />
        Do not contact this lead
      </label>
      {state.error ? <p className="text-sm text-destructive md:col-span-2">{state.error}</p> : null}
      {state.success ? <p className="text-sm md:col-span-2">{state.success}</p> : null}
      <div className="md:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : "Save lead"}
        </Button>
      </div>
    </form>
  );
}
