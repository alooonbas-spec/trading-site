"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createPostAction, idleActionState } from "@/app/actions/posts";
import { SocialAccountSelector } from "@/components/social-accounts/social-account-selector";
import type { SocialAccountPublic } from "@/types/social-account";

export function CreatePostForm({
  workspaceId,
  accounts,
}: {
  workspaceId: string;
  accounts: SocialAccountPublic[];
}) {
  const action = createPostAction.bind(null, workspaceId);
  const [state, formAction, pending] = useActionState(action, idleActionState);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);

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
          accounts={accounts}
          value={selectedAccounts}
          onChange={setSelectedAccounts}
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
