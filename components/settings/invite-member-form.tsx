"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { idleActionState, inviteMemberAction } from "@/app/actions/workspace";
import { ASSIGNABLE_ROLES } from "@/lib/validation/workspace";

export function InviteMemberForm({
  workspaceId,
  canInvite,
}: {
  workspaceId: string;
  canInvite: boolean;
}) {
  const action = inviteMemberAction.bind(null, workspaceId);
  const [state, formAction, pending] = useActionState(action, idleActionState);
  const [role, setRole] = useState<(typeof ASSIGNABLE_ROLES)[number]>("OPERATOR");

  if (!canInvite) {
    return <p className="text-sm text-muted-foreground">You cannot invite members with this role.</p>;
  }

  return (
    <form action={formAction} className="grid gap-4 md:grid-cols-[1fr_160px_auto] md:items-end">
      <div className="space-y-2">
        <Label htmlFor="invite-email">Email</Label>
        <Input id="invite-email" name="email" type="email" required placeholder="alex@example.com" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="invite-role">Role</Label>
        <input type="hidden" name="role" value={role} />
        <Select
          value={role}
          onValueChange={(value) => {
            if (value === "ADMIN" || value === "OPERATOR" || value === "VIEWER") {
              setRole(value);
            }
          }}
        >
          <SelectTrigger id="invite-role" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ASSIGNABLE_ROLES.map((assignableRole) => (
              <SelectItem key={assignableRole} value={assignableRole}>
                {assignableRole}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Adding..." : "Add member"}
      </Button>
      {state.error ? <p className="text-sm text-destructive md:col-span-3">{state.error}</p> : null}
      {state.success ? <p className="text-sm text-foreground md:col-span-3">{state.success}</p> : null}
    </form>
  );
}
