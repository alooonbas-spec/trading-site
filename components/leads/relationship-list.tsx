"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { updateRelationshipAction } from "@/app/actions/leads";
import { CONTACT_STATUSES } from "@/types/status";
import { SOCIAL_PLATFORM_LABELS } from "@/types/social";
import type { ContactRelationship, SocialProfile } from "@/types/crm";
import type { SocialAccountPublic } from "@/types/social-account";

export function RelationshipList({
  workspaceId,
  leadId,
  relationships,
  profiles,
  accounts,
  canMutate,
}: {
  workspaceId: string;
  leadId: string;
  relationships: ContactRelationship[];
  profiles: SocialProfile[];
  accounts: SocialAccountPublic[];
  canMutate: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (relationships.length === 0) {
    return <p className="text-sm text-muted-foreground">No contact relationships yet.</p>;
  }

  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
  const accountsById = new Map(accounts.map((account) => [account.id, account]));

  return (
    <div className="space-y-3">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {relationships.map((relationship) => {
        const profile = profilesById.get(relationship.socialProfileId);
        const account = accountsById.get(relationship.socialAccountId);
        return (
          <div key={relationship.id} className="rounded-lg border border-border px-3 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">
                  {profile
                    ? `${SOCIAL_PLATFORM_LABELS[profile.platform]} ${profile.username ?? profile.externalProfileId}`
                    : relationship.socialProfileId}
                  {" → "}
                  {account
                    ? `${SOCIAL_PLATFORM_LABELS[account.platform]} ${account.username ?? account.externalAccountId}`
                    : relationship.socialAccountId}
                </p>
                <p className="text-xs text-muted-foreground">
                  Contact status is independent from lead status.
                </p>
              </div>
              <Badge variant="secondary">{relationship.status}</Badge>
            </div>
            {canMutate ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {CONTACT_STATUSES.map((status) => (
                  <Button
                    key={status}
                    type="button"
                    size="sm"
                    variant={status === relationship.status ? "default" : "outline"}
                    disabled={pending}
                    onClick={() => {
                      setError(null);
                      startTransition(async () => {
                        const result = await updateRelationshipAction(
                          workspaceId,
                          leadId,
                          relationship.id,
                          status,
                        );
                        if (result.error) {
                          setError(result.error);
                        }
                      });
                    }}
                  >
                    {status}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
