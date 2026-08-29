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
import { searchPickerLeads } from "@/services/leads/lead-service";
import { listSocialAccountsByIds, searchPickerAccounts } from "@/services/social-accounts/account-service";
import { AttachInboxForm } from "@/components/inbox/attach-inbox-form";
import { InboxControls } from "@/components/inbox/inbox-controls";
import { InboxEventMeta } from "@/components/inbox/inbox-event-meta";
import { ReplyInboxForm } from "@/components/inbox/reply-inbox-form";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ListPagination } from "@/components/dashboard/list-pagination";
import { searchHref } from "@/lib/pagination/keyset";
import { LEAD_PICKER_LIMIT_HINT, toPickerLead } from "@/lib/leads/picker";
import {
  ACCOUNT_PICKER_LIMIT_HINT,
  toPickerAccount,
  withSelectedPickerAccount,
} from "@/lib/social-accounts/picker";
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
    after?: string;
    leadQ?: string;
    accountQ?: string;
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
  const [inboxPage, picker, accountPicker, selectedAccounts] = await Promise.all([
    listInboxEvents({
      workspaceId,
      match,
      query: query.q,
      socialAccountId,
      platform,
      replyKind,
      after: query.after,
    }),
    canMutate ? searchPickerLeads(workspaceId, query.leadQ) : Promise.resolve({ items: [], hasMore: false }),
    searchPickerAccounts(workspaceId, query.accountQ),
    socialAccountId ? listSocialAccountsByIds(workspaceId, [socialAccountId]) : Promise.resolve([]),
  ]);
  const events = inboxPage.items;
  const leads = picker.items.map(toPickerLead);
  const accounts = withSelectedPickerAccount(
    accountPicker.items.map(toPickerAccount),
    selectedAccounts[0] ? toPickerAccount(selectedAccounts[0]) : undefined,
  );
  const filterQuery = {
    q: query.q,
    match: match === "all" ? undefined : match,
    account: socialAccountId,
    platform,
    kind: replyKind,
    leadQ: query.leadQ,
    accountQ: query.accountQ,
  };
  const inboxPath = `/w/${workspaceId}/inbox`;

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
      <form className="grid gap-2 md:grid-cols-2 xl:grid-cols-7" method="get">
        {query.leadQ ? <input type="hidden" name="leadQ" value={query.leadQ} /> : null}
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
        <Input name="accountQ" placeholder="Find an account" defaultValue={query.accountQ ?? ""} />
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
      <p className="text-xs text-muted-foreground">
        {ACCOUNT_PICKER_LIMIT_HINT}
        {accountPicker.hasMore ? " More than 200 accounts match. Refine the search." : ""}
      </p>
      {canMutate ? (
        <form className="grid gap-2 md:grid-cols-[1fr_auto]" method="get">
          {query.q ? <input type="hidden" name="q" value={query.q} /> : null}
          {match !== "all" ? <input type="hidden" name="match" value={match} /> : null}
          {socialAccountId ? <input type="hidden" name="account" value={socialAccountId} /> : null}
          {query.accountQ ? <input type="hidden" name="accountQ" value={query.accountQ} /> : null}
          {platform ? <input type="hidden" name="platform" value={platform} /> : null}
          {replyKind ? <input type="hidden" name="kind" value={replyKind} /> : null}
          {query.after ? <input type="hidden" name="after" value={query.after} /> : null}
          <Input name="leadQ" placeholder="Find a lead to attach" defaultValue={query.leadQ ?? ""} />
          <Button type="submit" variant="outline">
            Find lead
          </Button>
        </form>
      ) : null}
      {canMutate ? (
        <p className="text-xs text-muted-foreground">
          {LEAD_PICKER_LIMIT_HINT}
          {picker.hasMore ? " More than 200 leads match. Refine the search." : ""}
        </p>
      ) : null}
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
              Showing {events.length} event{events.length === 1 ? "" : "s"} on this page. Matching uses
              the receiving account platform, not a platform switch in this page. Attach uses the newest
              200 matching leads. Older pages use a created_at keyset, not OFFSET.
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
            <div className="mt-4">
              <ListPagination
                newestHref={query.after ? searchHref(inboxPath, filterQuery) : null}
                olderHref={
                  inboxPage.nextCursor
                    ? searchHref(inboxPath, { ...filterQuery, after: inboxPage.nextCursor })
                    : null
                }
              />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
