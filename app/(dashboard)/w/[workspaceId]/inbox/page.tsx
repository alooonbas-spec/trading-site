import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { canMutateWorkspaceData } from "@/lib/auth/permissions";
import { listInboxEvents, parseInboxMatchFilter } from "@/services/inbox/query-service";
import { listLeads } from "@/services/leads/lead-service";
import { AttachInboxForm } from "@/components/inbox/attach-inbox-form";
import { InboxEventMeta } from "@/components/inbox/inbox-event-meta";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { INBOX_MATCH_FILTERS } from "@/types/inbox";

export default async function InboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ q?: string; match?: string }>;
}) {
  const { workspaceId } = await params;
  const query = await searchParams;
  const context = await requireWorkspaceContext(workspaceId);
  const canMutate = canMutateWorkspaceData(context.role);
  const match = parseInboxMatchFilter(query.match);
  const [events, leads] = await Promise.all([
    listInboxEvents({
      workspaceId,
      match,
      query: query.q,
    }),
    canMutate ? listLeads({ workspaceId }) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Official inbound replies. Unmatched senders stay stored until an operator attaches them to an
          existing lead. Inbox never creates people automatically.
        </p>
      </div>
      <form className="grid gap-2 md:grid-cols-[1fr_180px_auto]" method="get">
        <Input name="q" placeholder="Search sender or message" defaultValue={query.q ?? ""} />
        <select
          name="match"
          defaultValue={match}
          className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
        >
          {INBOX_MATCH_FILTERS.map((item) => (
            <option key={item} value={item}>
              {item === "all" ? "All events" : item === "unmatched" ? "Unmatched" : "Matched"}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>
      {events.length === 0 ? (
        <EmptyState
          title="No inbox events match"
          description="Poll a connected account, or clear filters. Unknown senders stay unmatched until you attach them."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Events</CardTitle>
            <CardDescription>
              Showing {events.length} event{events.length === 1 ? "" : "s"}. Matching uses the receiving
              account platform, not a platform switch in this page.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sender</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>{canMutate ? "Attach to lead" : "Lead"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="align-top">
                      <InboxEventMeta event={event} />
                    </TableCell>
                    <TableCell className="align-top text-sm whitespace-pre-wrap">{event.body}</TableCell>
                    <TableCell className="align-top">
                      {event.matched ? (
                        event.leadDisplayName ?? "Attached"
                      ) : canMutate ? (
                        <AttachInboxForm
                          workspaceId={workspaceId}
                          inboxEventId={event.id}
                          leads={leads}
                        />
                      ) : (
                        "Unmatched"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
