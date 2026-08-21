import Link from "next/link";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { canMutateWorkspaceData } from "@/lib/auth/permissions";
import { listMonitoringRulesPage } from "@/services/monitoring/rule-service";
import { listSocialAccounts } from "@/services/social-accounts/account-service";
import { CreateMonitoringRuleForm } from "@/components/monitoring/create-monitoring-rule-form";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ListPagination } from "@/components/dashboard/list-pagination";
import { searchHref } from "@/lib/pagination/keyset";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SOCIAL_PLATFORM_LABELS } from "@/types/social";

export default async function MonitoringPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ after?: string }>;
}) {
  const { workspaceId } = await params;
  const query = await searchParams;
  const context = await requireWorkspaceContext(workspaceId);
  const canMutate = canMutateWorkspaceData(context.role);
  const [rulesPage, accounts] = await Promise.all([
    listMonitoringRulesPage(workspaceId, query.after),
    listSocialAccounts(workspaceId),
  ]);
  const rules = rulesPage.items;
  const monitoringPath = `/w/${workspaceId}/monitoring`;

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
          title="No monitoring rules yet"
          description="Create a rule with keywords. X and Telegram can use a connected account; other platforms need TinyFish Search."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Rules</CardTitle>
            <CardDescription>
              Showing {rules.length} rule{rules.length === 1 ? "" : "s"} on this page. Older pages use a
              created_at keyset, not OFFSET.
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
                newestHref={query.after ? monitoringPath : null}
                olderHref={
                  rulesPage.nextCursor
                    ? searchHref(monitoringPath, { after: rulesPage.nextCursor })
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
