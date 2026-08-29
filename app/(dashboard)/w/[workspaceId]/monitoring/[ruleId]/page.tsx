import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { canManageWorkspace, canMutateWorkspaceData } from "@/lib/auth/permissions";
import { getMonitoringRule, listMonitoringEventsPage } from "@/services/monitoring/rule-service";
import { listMonitoringJobsPage } from "@/services/jobs/query-service";
import { listSocialAccountsByIds } from "@/services/social-accounts/account-service";
import { parseJobStatusFilter } from "@/lib/jobs/filters";
import { MonitoringRuleControls } from "@/components/monitoring/monitoring-rule-controls";
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
import { SOCIAL_PLATFORM_LABELS } from "@/types/social";
import { JOB_STATUSES } from "@/types/status";
import { ValidationError } from "@/lib/errors";

export default async function MonitoringRuleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; ruleId: string }>;
  searchParams: Promise<{ after?: string; jobs?: string; status?: string }>;
}) {
  const { workspaceId, ruleId } = await params;
  const query = await searchParams;
  const context = await requireWorkspaceContext(workspaceId);
  const status = parseJobStatusFilter(query.status);

  let rule;
  try {
    rule = await getMonitoringRule(workspaceId, ruleId);
  } catch (error) {
    if (error instanceof ValidationError) {
      notFound();
    }
    throw error;
  }

  const [eventsPage, jobsPage] = await Promise.all([
    listMonitoringEventsPage(workspaceId, ruleId, query.after),
    listMonitoringJobsPage(workspaceId, ruleId, { after: query.jobs, status }),
  ]);
  const events = eventsPage.items;
  const jobs = jobsPage.items;
  const accountIds = [
    ...(rule.socialAccountId ? [rule.socialAccountId] : []),
    ...jobs.map((job) => job.socialAccountId).filter((id): id is string => id !== null),
  ];
  const accounts = await listSocialAccountsByIds(workspaceId, accountIds);
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
              newestHref={query.after ? searchHref(rulePath, { jobs: query.jobs, status }) : null}
              olderHref={
                eventsPage.nextCursor
                  ? searchHref(rulePath, {
                      after: eventsPage.nextCursor,
                      jobs: query.jobs,
                      status,
                    })
                  : null
              }
            />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Jobs</CardTitle>
          <CardDescription>
            Showing {jobs.length} job{jobs.length === 1 ? "" : "s"} on this page. JobStatus stays on its
            own machine. Older pages use a created_at keyset, not OFFSET.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="mb-4 grid gap-2 md:grid-cols-[220px_auto]" method="get">
            {query.after ? <input type="hidden" name="after" value={query.after} /> : null}
            <select
              name="status"
              defaultValue={status ?? ""}
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
            >
              <option value="">All job statuses</option>
              {JOB_STATUSES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <Button type="submit" variant="outline">
              Filter
            </Button>
          </form>
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {status ? "No jobs match this JobStatus." : "No jobs yet."}
            </p>
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
          <div className="mt-4">
            <ListPagination
              newestHref={query.jobs ? searchHref(rulePath, { after: query.after, status }) : null}
              olderHref={
                jobsPage.nextCursor
                  ? searchHref(rulePath, {
                      after: query.after,
                      status,
                      jobs: jobsPage.nextCursor,
                    })
                  : null
              }
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
