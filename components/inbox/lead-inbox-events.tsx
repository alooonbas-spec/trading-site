import { InboxEventMeta } from "@/components/inbox/inbox-event-meta";
import { ReplyInboxForm } from "@/components/inbox/reply-inbox-form";
import type { InboxEventListItem } from "@/types/inbox";

export function LeadInboxEvents({
  events,
  canMutate,
}: {
  events: InboxEventListItem[];
  canMutate: boolean;
}) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No matched inbox replies for this lead yet. Attach unmatched senders from Inbox.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {events.map((event) => (
        <li key={event.id} className="rounded-lg border border-border px-3 py-2">
          <InboxEventMeta event={event} />
          <p className="mt-2 text-sm whitespace-pre-wrap">{event.body}</p>
          {canMutate ? <ReplyInboxForm workspaceId={event.workspaceId} inboxEventId={event.id} /> : null}
        </li>
      ))}
    </ul>
  );
}
