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
import { connectTelegramAction, idleActionState } from "@/app/actions/social-accounts";

export function ConnectTelegramDialog({ workspaceId }: { workspaceId: string }) {
  const action = connectTelegramAction.bind(null, workspaceId);
  const [state, formAction, pending] = useActionState(action, idleActionState);

  return (
    <Dialog>
      <DialogTrigger render={<Button />}>Connect Telegram</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect a Telegram bot</DialogTitle>
          <DialogDescription>
            Paste a bot token from BotFather. The token is stored encrypted on the server and is
            never sent back to the browser.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="token">Bot token</Label>
            <Input id="token" name="token" type="password" autoComplete="off" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="publishChatId">Publish channel (optional)</Label>
            <Input
              id="publishChatId"
              name="publishChatId"
              placeholder="@channel or numeric chat id"
              autoComplete="off"
            />
            <p className="text-muted-foreground text-sm">
              Needed to publish bot posts. Direct messages still use the lead profile username or chat
              id.
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
