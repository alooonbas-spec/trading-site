"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SocialAccountSelector } from "@/components/social-accounts/social-account-selector";
import { createGroupAction, idleActionState } from "@/app/actions/social-accounts";
import type { AccountGroup, SocialAccountPublic } from "@/types/social-account";

export function CreateGroupForm({
  workspaceId,
  accounts,
  groups,
}: {
  workspaceId: string;
  accounts: SocialAccountPublic[];
  groups: AccountGroup[];
}) {
  const action = createGroupAction.bind(null, workspaceId);
  const [state, formAction, pending] = useActionState(action, idleActionState);
  const [selected, setSelected] = useState<string[]>([]);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="group-name">Group name</Label>
        <Input id="group-name" name="name" placeholder="Trading Brand" required minLength={2} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="group-description">Description</Label>
        <Textarea id="group-description" name="description" />
      </div>
      <div className="space-y-2">
        <Label>Accounts</Label>
        <SocialAccountSelector
          accounts={accounts}
          groups={groups}
          value={selected}
          onChange={setSelected}
          name="accountIds"
        />
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.success ? <p className="text-sm">{state.success}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Creating..." : "Create group"}
      </Button>
    </form>
  );
}
