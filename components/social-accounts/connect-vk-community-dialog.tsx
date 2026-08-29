"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { connectVkCommunityAction, idleActionState } from "@/app/actions/social-accounts";

export function ConnectVkCommunityDialog({ workspaceId }: { workspaceId: string }) {
  const action = connectVkCommunityAction.bind(null, workspaceId);
  const [state, formAction, pending] = useActionState(action, idleActionState);

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" />}>Connect VK community</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect a VK community token</DialogTitle>
          <DialogDescription>
            Paste a community access key from Manage → API. The token is stored encrypted on the
            server and is never sent back to the browser. User OAuth still cannot send Direct
            Messages.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="vkCommunityToken">Community token</Label>
            <Input id="vkCommunityToken" name="token" type="password" autoComplete="off" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vkGroupId">Community id or screen name</Label>
            <Input
              id="vkGroupId"
              name="groupId"
              placeholder="12345, club12345, or screen name"
              autoComplete="off"
              required
            />
            <p className="text-muted-foreground text-sm">
              Messages need the messages right on the token. Recipients must allow community
              messages. Inbox reads the latest 50 Direct Messages per 1:1 conversation. INVITE stays
              unavailable.
            </p>
          </div>
          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
          {state.success ? <p className="text-sm">{state.success}</p> : null}
          <Button type="submit" disabled={pending}>
            {pending ? "Connecting..." : "Connect"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
