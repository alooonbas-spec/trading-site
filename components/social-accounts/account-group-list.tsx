"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { deleteGroupAction } from "@/app/actions/social-accounts";
import type { AccountGroup } from "@/types/social-account";

export function AccountGroupList({
  workspaceId,
  groups,
  canManage,
}: {
  workspaceId: string;
  groups: AccountGroup[];
  canManage: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (groups.length === 0) {
    return <p className="text-sm text-muted-foreground">No account groups yet.</p>;
  }

  return (
    <div className="space-y-3">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {groups.map((group) => (
        <div key={group.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
          <div>
            <p className="text-sm font-medium">{group.name}</p>
            <p className="text-xs text-muted-foreground">
              {group.accountIds.length} accounts{group.description ? ` · ${group.description}` : ""}
            </p>
          </div>
          {canManage ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const result = await deleteGroupAction(workspaceId, group.id);
                  if (result.error) {
                    setError(result.error);
                  }
                });
              }}
            >
              Delete
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
