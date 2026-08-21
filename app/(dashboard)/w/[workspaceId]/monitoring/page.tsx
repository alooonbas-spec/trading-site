import Link from "next/link";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { canMutateWorkspaceData } from "@/lib/auth/permissions";
import { listMonitoringRules } from "@/services/monitoring/rule-service";
import { listSocialAccounts } from "@/services/social-accounts/account-service";
import { CreateMonitoringRuleForm } from "@/components/monitoring/create-monitoring-rule-form";
import { EmptyState } from "@/components/dashboard/empty-state";
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
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const context = await requireWorkspaceContext(workspaceId);
  const canMutate = canMutateWorkspaceData(context.role);
  const [rules, accounts] = await Promise.all([
    listMonitoringRules(workspaceId),
    listSocialAccounts(workspaceId),
  ]);

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
          </CardContent>
        </Card>
      )}
    </div>
  );
}
