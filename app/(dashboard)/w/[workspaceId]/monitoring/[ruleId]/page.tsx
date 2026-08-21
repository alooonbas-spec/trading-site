import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { canManageWorkspace, canMutateWorkspaceData } from "@/lib/auth/permissions";
import { getMonitoringRule, listMonitoringEventsPage } from "@/services/monitoring/rule-service";
import { listMonitoringJobs } from "@/services/jobs/worker-service";
import { listSocialAccounts } from "@/services/social-accounts/account-service";
import { MonitoringRuleControls } from "@/components/monitoring/monitoring-rule-controls";
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
import { ValidationError } from "@/lib/errors";

export default async function MonitoringRuleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; ruleId: string }>;
  searchParams: Promise<{ after?: string }>;
}) {
  const { workspaceId, ruleId } = await params;
  const query = await searchParams;
  const context = await requireWorkspaceContext(workspaceId);

  let rule;
  try {
    rule = await getMonitoringRule(workspaceId, ruleId);
  } catch (error) {
    if (error instanceof ValidationError) {
      notFound();
    }
    throw error;
  }

  const [eventsPage, jobs, accounts] = await Promise.all([
    listMonitoringEventsPage(workspaceId, ruleId, query.after),
    listMonitoringJobs(workspaceId, ruleId),
    listSocialAccounts(workspaceId),
  ]);
  const events = eventsPage.items;
  const rulePath = `/w/${workspaceId}/monitoring/${ruleId}`;
  const account = rule.socialAccountId
    ? accounts.find((item) => item.id === rule.socialAccountId)
    : undefined;

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/w/${workspaceId}/monitoring`} className="text-sm text-muted-foreground hover:underline">
          Back to monitoring
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{rule.name}</h1>
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge variant="secondary">{rule.status}</Badge>
          <Badge variant="outline">{SOCIAL_PLATFORM_LABELS[rule.platform]}</Badge>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Rule</CardTitle>
          <CardDescription>
            {account
              ? `Using ${account.username ?? account.externalAccountId}`
              : "No connected account. Public search requires TinyFish Search."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            <span className="text-muted-foreground">Keywords:</span> {rule.keywords.join(", ")}
          </p>
          <p>
            <span className="text-muted-foreground">Sources:</span>{" "}
            {rule.sources.length > 0 ? rule.sources.join(", ") : "Official platform domains"}
          </p>
          {rule.lastError ? <p className="text-destructive">{rule.lastError}</p> : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Controls</CardTitle>
          <CardDescription>
            Run enqueues a MONITOR job. Process queue claims jobs with SKIP LOCKED.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MonitoringRuleControls
            workspaceId={workspaceId}
            rule={rule}
            canMutate={canMutateWorkspaceData(context.role)}
            canDelete={canManageWorkspace(context.role)}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Events</CardTitle>
          <CardDescription>
            {rule.eventCount} stored events. Duplicates are ignored. Older pages use a created_at keyset,
            not OFFSET.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events yet. Run the rule and process the queue.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Author</TableHead>
                  <TableHead>Content</TableHead>
                  <TableHead>Keywords</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell>{event.author ?? "—"}</TableCell>
                    <TableCell className="max-w-md">
                      {event.url ? (
                        <a href={event.url} className="underline" target="_blank" rel="noreferrer">
                          {event.content.slice(0, 160)}
                          {event.content.length > 160 ? "…" : ""}
                        </a>
                      ) : (
                        <span>
                          {event.content.slice(0, 160)}
                          {event.content.length > 160 ? "…" : ""}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{event.matchedKeywords.join(", ")}</TableCell>
                    <TableCell>{new Date(event.createdAt).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div className="mt-4">
            <ListPagination
              newestHref={query.after ? rulePath : null}
              olderHref={
                eventsPage.nextCursor ? searchHref(rulePath, { after: eventsPage.nextCursor }) : null
              }
            />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Jobs</CardTitle>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No jobs yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell>
                      <Badge variant="secondary">{job.status}</Badge>
                    </TableCell>
                    <TableCell>
                      {job.attempts}/{job.maxAttempts}
                    </TableCell>
                    <TableCell className="max-w-xs truncate">{job.lastError ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
