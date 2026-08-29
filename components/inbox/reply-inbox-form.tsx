"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { idleActionState, replyInboxEventAction } from "@/app/actions/inbox";

export function ReplyInboxForm({
  workspaceId,
  inboxEventId,
}: {
  workspaceId: string;
  inboxEventId: string;
}) {
  const action = replyInboxEventAction.bind(null, workspaceId, inboxEventId);
  const [state, formAction, pending] = useActionState(action, idleActionState);

  return (
    <form action={formAction} className="mt-2 space-y-2">
      <Label htmlFor={`inbox-reply-${inboxEventId}`} className="sr-only">
        Reply
      </Label>
      <Textarea
        id={`inbox-reply-${inboxEventId}`}
        name="body"
        required
        rows={2}
        placeholder="Official reply"
        className="min-h-16"
      />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Sending..." : "Send reply"}
      </Button>
      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
      {state.success ? <p className="text-xs text-muted-foreground">{state.success}</p> : null}
    </form>
  );
}
