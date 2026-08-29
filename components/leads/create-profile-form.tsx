"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createProfileAction, idleActionState } from "@/app/actions/leads";
import { SOCIAL_PLATFORMS, SOCIAL_PLATFORM_LABELS } from "@/types/social";

export function CreateProfileForm({ workspaceId, leadId }: { workspaceId: string; leadId: string }) {
  const action = createProfileAction.bind(null, workspaceId, leadId);
  const [state, formAction, pending] = useActionState(action, idleActionState);

  return (
    <form action={formAction} className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="profile-platform">Platform</Label>
        <select
          id="profile-platform"
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
        <Label htmlFor="profile-external">External profile id</Label>
        <Input id="profile-external" name="externalProfileId" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="profile-username">Username</Label>
        <Input id="profile-username" name="username" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="profile-display">Display name</Label>
        <Input id="profile-display" name="displayName" />
      </div>
      <div className="space-y-2 md:col-span-2">
        <Label htmlFor="profile-url">Profile URL</Label>
        <Input id="profile-url" name="profileUrl" />
      </div>
      {state.error ? <p className="text-sm text-destructive md:col-span-2">{state.error}</p> : null}
      {state.success ? <p className="text-sm md:col-span-2">{state.success}</p> : null}
      <div className="md:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Linking..." : "Link profile"}
        </Button>
      </div>
    </form>
  );
}
