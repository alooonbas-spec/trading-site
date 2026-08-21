"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { createRelationshipAction, idleActionState } from "@/app/actions/leads";
import { SOCIAL_PLATFORM_LABELS } from "@/types/social";
import type { SocialProfile } from "@/types/crm";
import type { SocialAccountPublic } from "@/types/social-account";

export function CreateRelationshipForm({
  workspaceId,
  leadId,
  profiles,
  accounts,
}: {
  workspaceId: string;
  leadId: string;
  profiles: SocialProfile[];
  accounts: SocialAccountPublic[];
}) {
  const action = createRelationshipAction.bind(null, workspaceId, leadId);
  const [state, formAction, pending] = useActionState(action, idleActionState);

  if (profiles.length === 0 || accounts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Link a social profile and connect a workspace account before creating a contact relationship.
      </p>
    );
  }

  return (
    <form action={formAction} className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
      <div className="space-y-2">
        <Label htmlFor="rel-profile">Their profile</Label>
        <select
          id="rel-profile"
          name="socialProfileId"
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
        >
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {SOCIAL_PLATFORM_LABELS[profile.platform]} {profile.username ?? profile.externalProfileId}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="rel-account">Our account</Label>
        <select
          id="rel-account"
          name="socialAccountId"
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
        >
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {SOCIAL_PLATFORM_LABELS[account.platform]} {account.username ?? account.externalAccountId}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Creating..." : "Create relationship"}
      </Button>
      {state.error ? <p className="text-sm text-destructive md:col-span-3">{state.error}</p> : null}
      {state.success ? <p className="text-sm md:col-span-3">{state.success}</p> : null}
    </form>
  );
}
