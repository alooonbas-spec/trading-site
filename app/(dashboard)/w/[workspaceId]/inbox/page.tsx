import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { canManageAccounts, canMutateWorkspaceData } from "@/lib/auth/permissions";
import { listInboxEvents } from "@/services/inbox/query-service";
import {
  parseInboxAccountIdFilter,
  parseInboxMatchFilter,
  parseInboxPlatformFilter,
  parseInboxReplyKindFilter,
} from "@/lib/inbox/filters";
import { INBOX_REPLY_KIND_LABELS } from "@/lib/inbox/reply-kind";
import { listLeads } from "@/services/leads/lead-service";
import { listSocialAccounts } from "@/services/social-accounts/account-service";
import { AttachInboxForm } from "@/components/inbox/attach-inbox-form";
import { InboxControls } from "@/components/inbox/inbox-controls";
import { InboxEventMeta } from "@/components/inbox/inbox-event-meta";
import { ReplyInboxForm } from "@/components/inbox/reply-inbox-form";
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
import { INBOX_REPLY_KINDS } from "@/social/core/adapter";
import { SOCIAL_PLATFORM_LABELS, SOCIAL_PLATFORMS } from "@/types/social";

export default async function InboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{
    q?: string;
    match?: string;
    account?: string;
    platform?: string;
    kind?: string;
  }>;
}) {
  const { workspaceId } = await params;
  const query = await searchParams;
  const context = await requireWorkspaceContext(workspaceId);
  const canMutate = canMutateWorkspaceData(context.role);
  const canManage = canManageAccounts(context.role);
  const match = parseInboxMatchFilter(query.match);
  const socialAccountId = parseInboxAccountIdFilter(query.account);
  const platform = parseInboxPlatformFilter(query.platform);
  const replyKind = parseInboxReplyKindFilter(query.kind);
  const [events, leads, accounts] = await Promise.all([
    listInboxEvents({
      workspaceId,
      match,
      query: query.q,
      socialAccountId,
      platform,
      replyKind,
    }),
    canMutate ? listLeads({ workspaceId }) : Promise.resolve([]),
    listSocialAccounts(workspaceId),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Official inbound replies. Unmatched senders stay stored until an operator attaches them to an
          existing lead. Inbox never creates people automatically. Outbound replies use official APIs
          for the receiving account. Kind filter uses stored reply_kind from collection.
        </p>
      </div>
      <InboxControls
        workspaceId={workspaceId}
        accountId={socialAccountId}
        canManage={canManage}
        canMutate={canMutate}
      />
      <form className="grid gap-2 md:grid-cols-2 xl:grid-cols-6" method="get">
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
        <select
          name="platform"
          defaultValue={platform ?? ""}
          className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
        >
          <option value="">All platforms</option>
          {SOCIAL_PLATFORMS.map((item) => (
            <option key={item} value={item}>
              {SOCIAL_PLATFORM_LABELS[item]}
            </option>
          ))}
        </select>
        <select
          name="account"
          defaultValue={socialAccountId ?? ""}
          className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
        >
          <option value="">All accounts</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {SOCIAL_PLATFORM_LABELS[account.platform]}{" "}
              {account.username ?? account.displayName ?? account.externalAccountId}
            </option>
          ))}
        </select>
        <select
          name="kind"
          defaultValue={replyKind ?? ""}
          className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
        >
          <option value="">All kinds</option>
          {INBOX_REPLY_KINDS.map((item) => (
            <option key={item} value={item}>
              {INBOX_REPLY_KIND_LABELS[item]}
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
                  {canMutate ? <TableHead>Reply</TableHead> : null}
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
                    {canMutate ? (
                      <TableCell className="align-top">
                        <ReplyInboxForm workspaceId={workspaceId} inboxEventId={event.id} />
                      </TableCell>
                    ) : null}
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
