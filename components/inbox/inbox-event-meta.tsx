import Link from "next/link";
import { SOCIAL_PLATFORM_LABELS } from "@/types/social";
import type { InboxEventListItem } from "@/types/inbox";
import { Badge } from "@/components/ui/badge";

export function InboxEventMeta({ event }: { event: InboxEventListItem }) {
  const sender = event.username ?? event.externalProfileId;
  const account = event.accountDisplayName ?? event.accountUsername ?? "account";
  const received = event.receivedAt ?? event.createdAt;

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{SOCIAL_PLATFORM_LABELS[event.platform]}</Badge>
        {event.matched ? <Badge>Matched</Badge> : <Badge variant="outline">Unmatched</Badge>}
        {event.leadId && event.leadDisplayName ? (
          <Link
            href={`/w/${event.workspaceId}/leads/${event.leadId}`}
            className="text-sm font-medium underline-offset-4 hover:underline"
          >
            {event.leadDisplayName}
          </Link>
        ) : null}
      </div>
      <p className="text-sm">
        <span className="font-medium">{sender}</span>
        <span className="text-muted-foreground">
          {" "}
          → {account} · {new Date(received).toLocaleString()}
        </span>
      </p>
      {event.url ? (
        <a href={event.url} className="text-xs underline" target="_blank" rel="noreferrer">
          Open source
        </a>
      ) : null}
    </div>
  );
}
