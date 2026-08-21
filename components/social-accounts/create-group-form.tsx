"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SocialAccountSelector } from "@/components/social-accounts/social-account-selector";
import { createGroupAction, idleActionState } from "@/app/actions/social-accounts";
import type { AccountGroup } from "@/types/social-account";
import type { PickerAccount } from "@/lib/social-accounts/picker";

export function CreateGroupForm({
  workspaceId,
  initialAccounts,
  initialHasMore,
  groups,
}: {
  workspaceId: string;
  initialAccounts: PickerAccount[];
  initialHasMore: boolean;
  groups: AccountGroup[];
}) {
  const action = createGroupAction.bind(null, workspaceId);
  const [state, formAction, pending] = useActionState(action, idleActionState);

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
          workspaceId={workspaceId}
          initialAccounts={initialAccounts}
          initialHasMore={initialHasMore}
          groups={groups}
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
