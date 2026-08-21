"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { collectPublicProfileAction, idleActionState } from "@/app/actions/leads";
import { SOCIAL_PLATFORMS, SOCIAL_PLATFORM_LABELS } from "@/types/social";

export function CollectPublicProfileForm({
  workspaceId,
  leadId,
  enabled,
}: {
  workspaceId: string;
  leadId: string;
  enabled: boolean;
}) {
  const action = collectPublicProfileAction.bind(null, workspaceId, leadId);
  const [state, formAction, pending] = useActionState(action, idleActionState);

  if (!enabled) {
    return (
      <p className="text-sm text-muted-foreground">
        Public collection is not configured on the server.
      </p>
    );
  }

  return (
    <form action={formAction} className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="collect-platform">Platform</Label>
        <select
          id="collect-platform"
          name="platform"
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
        >
          {SOCIAL_PLATFORMS.map((platform) => (
            <option key={platform} value={platform}>
              {SOCIAL_PLATFORM_LABELS[platform]}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="collect-source">Username or public profile URL</Label>
        <Input id="collect-source" name="source" required placeholder="@username or https://..." />
      </div>
      {state.error ? <p className="text-sm text-destructive md:col-span-2">{state.error}</p> : null}
      {state.success ? <p className="text-sm md:col-span-2">{state.success}</p> : null}
      <div className="md:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Collecting..." : "Collect public profile"}
        </Button>
      </div>
    </form>
  );
}
