import Link from "next/link";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { canMutateWorkspaceData } from "@/lib/auth/permissions";
import { listMonitoringRulesPage } from "@/services/monitoring/rule-service";
import { parseMonitoringPlatformFilter, parseMonitoringStatusFilter } from "@/lib/monitoring/filters";
import { listSocialAccounts } from "@/services/social-accounts/account-service";
import { CreateMonitoringRuleForm } from "@/components/monitoring/create-monitoring-rule-form";
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
import { SOCIAL_PLATFORM_LABELS, SOCIAL_PLATFORMS } from "@/types/social";
import { MONITORING_RULE_STATUSES } from "@/types/status";

export default async function MonitoringPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ after?: string; status?: string; platform?: string }>;
}) {
  const { workspaceId } = await params;
  const query = await searchParams;
  const context = await requireWorkspaceContext(workspaceId);
  const canMutate = canMutateWorkspaceData(context.role);
  const status = parseMonitoringStatusFilter(query.status);
  const platform = parseMonitoringPlatformFilter(query.platform);
  const [rulesPage, accounts] = await Promise.all([
    listMonitoringRulesPage(workspaceId, { after: query.after, status, platform }),
    listSocialAccounts(workspaceId),
  ]);
  const rules = rulesPage.items;
  const monitoringPath = `/w/${workspaceId}/monitoring`;
  const filterQuery = { status, platform };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Monitoring</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Rules run through social adapters only. Official APIs are used when an account is connected.
          Public keyword search uses TinyFish Search on official domains. Missing keys and unsupported
          platforms fail instead of inventing events.
        </p>
      </div>
      <form className="grid gap-2 md:grid-cols-2 xl:grid-cols-3" method="get">
        <select
          name="status"
          defaultValue={status ?? ""}
          className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
        >
          <option value="">All rule statuses</option>
          {MONITORING_RULE_STATUSES.map((item) => (
            <option key={item} value={item}>
              {item}
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
      {canMutate ? (
        <Card>
          <CardHeader>
            <CardTitle>Create rule</CardTitle>
            <CardDescription>
              Keywords are matched after collection. Sources must be official platform hosts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateMonitoringRuleForm workspaceId={workspaceId} accounts={accounts} />
          </CardContent>
        </Card>
      ) : null}
      {rules.length === 0 ? (
        <EmptyState
          title="No monitoring rules match"
          description="Create a rule with keywords, or clear filters. X and Telegram can use a connected account; other platforms need TinyFish Search."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Rules</CardTitle>
            <CardDescription>
              Showing {rules.length} rule{rules.length === 1 ? "" : "s"} on this page. Platform is rule identity,
              not a business-logic switch. Older pages use a created_at keyset, not OFFSET.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Events</TableHead>
                  <TableHead>Last run</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell>
                      <Link
                        href={`/w/${workspaceId}/monitoring/${rule.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {rule.name}
                      </Link>
                    </TableCell>
                    <TableCell>{SOCIAL_PLATFORM_LABELS[rule.platform]}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{rule.status}</Badge>
                    </TableCell>
                    <TableCell>{rule.eventCount}</TableCell>
                    <TableCell>
                      {rule.lastRunAt ? new Date(rule.lastRunAt).toLocaleString() : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="mt-4">
              <ListPagination
                newestHref={query.after ? searchHref(monitoringPath, filterQuery) : null}
                olderHref={
                  rulesPage.nextCursor
                    ? searchHref(monitoringPath, { ...filterQuery, after: rulesPage.nextCursor })
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
