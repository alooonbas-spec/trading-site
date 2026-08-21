import Link from "next/link";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { listWorkspaceActivity } from "@/services/activity/query-service";
import { listSocialAccounts } from "@/services/social-accounts/account-service";
import {
  parseActivityAccountIdFilter,
  parseActivityActionFilter,
  parseActivityEntityTypeFilter,
  parseActivityPlatformFilter,
} from "@/lib/activity/filters";
import { activityEntityHref } from "@/lib/activity/links";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ListPagination } from "@/components/dashboard/list-pagination";
import { searchHref } from "@/lib/pagination/keyset";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES } from "@/types/activity";
import { SOCIAL_PLATFORM_LABELS, SOCIAL_PLATFORMS } from "@/types/social";

export default async function ActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ action?: string; entity?: string; account?: string; platform?: string; after?: string }>;
}) {
  const { workspaceId } = await params;
  const query = await searchParams;
  await requireWorkspaceContext(workspaceId);
  const action = parseActivityActionFilter(query.action);
  const entityType = parseActivityEntityTypeFilter(query.entity);
  const socialAccountId = parseActivityAccountIdFilter(query.account);
  const platform = parseActivityPlatformFilter(query.platform);
  const [activityPage, accounts] = await Promise.all([
    listWorkspaceActivity({
      workspaceId,
      action,
      entityType,
      socialAccountId,
      platform,
      after: query.after,
    }),
    listSocialAccounts(workspaceId),
  ]);
  const events = activityPage.items;
  const activityPath = `/w/${workspaceId}/activity`;
  const filterQuery = {
    action,
    entity: entityType,
    account: socialAccountId,
    platform,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Append-only workspace audit log. Metadata is redacted before display. Tokens and secrets never
          appear here. Activity does not rewrite LeadStatus or do_not_contact.
        </p>
      </div>
      <form className="grid gap-2 md:grid-cols-2 xl:grid-cols-5" method="get">
        <select
          name="action"
          defaultValue={action ?? ""}
          className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
        >
          <option value="">All actions</option>
          {ACTIVITY_ACTIONS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select
          name="entity"
          defaultValue={entityType ?? ""}
          className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
        >
          <option value="">All entities</option>
          {ACTIVITY_ENTITY_TYPES.map((item) => (
            <option key={item} value={item}>
              {item}
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
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>
      {events.length === 0 ? (
        <EmptyState
          title="No activity matches"
          description="Connect accounts, run campaigns, or process jobs to write activity_log rows."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Log</CardTitle>
            <CardDescription>
              Showing {events.length} event{events.length === 1 ? "" : "s"} on this page. Newest first.
              Platform is account identity, not a business-logic switch. Older pages use a created_at keyset, not OFFSET.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Metadata</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => {
                  const href = activityEntityHref(workspaceId, event.entityType, event.entityId);
                  const entityLabel = event.entityType
                    ? `${event.entityType}${event.entityId ? ` ${event.entityId.slice(0, 8)}` : ""}`
                    : "—";
                  return (
                    <TableRow key={event.id}>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {formatActivityTime(event.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{event.action}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {event.userDisplayName ?? event.userEmail ?? "system"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {event.platform
                          ? `${SOCIAL_PLATFORM_LABELS[event.platform]} ${event.accountDisplayName ?? event.accountUsername ?? ""}`.trim()
                          : "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {href ? (
                          <Link href={href} className="underline-offset-4 hover:underline">
                            {entityLabel}
                          </Link>
                        ) : (
                          entityLabel
                        )}
                      </TableCell>
                      <TableCell className="max-w-xs truncate font-mono text-xs">
                        {formatActivityMetadata(event.metadata)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <div className="mt-4">
              <ListPagination
                newestHref={query.after ? searchHref(activityPath, filterQuery) : null}
                olderHref={
                  activityPage.nextCursor
                    ? searchHref(activityPath, { ...filterQuery, after: activityPage.nextCursor })
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

function formatActivityTime(value: string): string {
  return `${value.replace("T", " ").slice(0, 19)} UTC`;
}

function formatActivityMetadata(metadata: Record<string, unknown>): string {
  const keys = Object.keys(metadata);
  if (keys.length === 0) {
    return "—";
  }
  const encoded = JSON.stringify(metadata);
  return encoded.length > 120 ? `${encoded.slice(0, 117)}...` : encoded;
}
