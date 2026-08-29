"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createPostAction, idleActionState } from "@/app/actions/posts";
import { SocialAccountSelector } from "@/components/social-accounts/social-account-selector";
import type { PickerAccount } from "@/lib/social-accounts/picker";

export function CreatePostForm({
  workspaceId,
  initialAccounts,
  initialHasMore,
}: {
  workspaceId: string;
  initialAccounts: PickerAccount[];
  initialHasMore: boolean;
}) {
  const action = createPostAction.bind(null, workspaceId);
  const [state, formAction, pending] = useActionState(action, idleActionState);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="post-body">Body</Label>
        <Textarea id="post-body" name="body" required maxLength={4000} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="post-media">Media URLs (optional)</Label>
        <Textarea id="post-media" name="media" placeholder="One URL per line" />
        <p className="text-xs text-muted-foreground">
          X, Telegram, Facebook Pages, Instagram, and VK can publish public media URLs through
          official APIs. Instagram requires an image or mp4. Reconnect Facebook, Instagram, and VK
          accounts to grant publish scopes.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="post-scheduled">Schedule (optional)</Label>
        <Input id="post-scheduled" name="scheduledAt" type="datetime-local" />
      </div>
      <div className="space-y-2">
        <Label>Target accounts</Label>
        <SocialAccountSelector
          workspaceId={workspaceId}
          initialAccounts={initialAccounts}
          initialHasMore={initialHasMore}
          name="accountIds"
        />
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Save draft"}
      </Button>
    </form>
  );
}
