import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { canMutateWorkspaceData } from "@/lib/auth/permissions";
import { listWorkspaceJobs } from "@/services/jobs/query-service";
import { listSocialAccounts } from "@/services/social-accounts/account-service";
import {
  parseJobAccountIdFilter,
  parseJobStatusFilter,
  parseJobTypeFilter,
} from "@/lib/jobs/filters";
import { JobsQueueControls } from "@/components/jobs/jobs-queue-controls";
import { JobRowControls } from "@/components/jobs/job-row-controls";
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
import { JOB_TYPES } from "@/types/campaign";
import { JOB_STATUSES } from "@/types/status";
import { SOCIAL_PLATFORM_LABELS } from "@/types/social";

export default async function JobsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ type?: string; status?: string; account?: string; after?: string }>;
}) {
  const { workspaceId } = await params;
  const query = await searchParams;
  const context = await requireWorkspaceContext(workspaceId);
  const canMutate = canMutateWorkspaceData(context.role);
  const type = parseJobTypeFilter(query.type);
  const status = parseJobStatusFilter(query.status);
  const socialAccountId = parseJobAccountIdFilter(query.account);
  const [jobsPage, accounts] = await Promise.all([
    listWorkspaceJobs({
      workspaceId,
      type,
      status,
      socialAccountId,
      after: query.after,
    }),
    listSocialAccounts(workspaceId),
  ]);
  const jobs = jobsPage.items;
  const jobsPath = `/w/${workspaceId}/jobs`;
  const filterQuery = {
    type,
    status,
    account: socialAccountId,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Shared workspace queue for CONTACT, PUBLISH, MONITOR, and INBOX jobs. JobStatus stays on
          its own machine. Retry does not rewrite LeadStatus or do_not_contact.
        </p>
      </div>
      <JobsQueueControls workspaceId={workspaceId} canMutate={canMutate} />
      <form className="grid gap-2 md:grid-cols-2 xl:grid-cols-4" method="get">
        <select
          name="type"
          defaultValue={type ?? ""}
          className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
        >
          <option value="">All types</option>
          {JOB_TYPES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select
          name="status"
          defaultValue={status ?? ""}
          className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
        >
          <option value="">All statuses</option>
          {JOB_STATUSES.map((item) => (
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
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>
      {jobs.length === 0 ? (
        <EmptyState
          title="No jobs match"
          description="Start a campaign, publish a post, run monitoring, or poll inbox to enqueue work."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Queue</CardTitle>
            <CardDescription>
              Showing {jobs.length} job{jobs.length === 1 ? "" : "s"} on this page. Process queue still
              uses SKIP LOCKED. Cancelled and successful jobs are not retried. Older pages use a
              created_at keyset, not OFFSET.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>Error</TableHead>
                  {canMutate ? <TableHead>Actions</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell>
                      <Badge variant="secondary">{job.type}</Badge>
                    </TableCell>
                    <TableCell className="max-w-xs text-sm">
                      {job.leadDisplayName ??
                        job.campaignName ??
                        job.monitoringRuleName ??
                        job.postExcerpt ??
                        "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {job.platform
                        ? `${SOCIAL_PLATFORM_LABELS[job.platform]} ${job.accountDisplayName ?? job.accountUsername ?? ""}`.trim()
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{job.status}</Badge>
                    </TableCell>
                    <TableCell>
                      {job.attempts}/{job.maxAttempts}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-sm">{job.lastError ?? "—"}</TableCell>
                    {canMutate ? (
                      <TableCell>
                        <JobRowControls
                          workspaceId={workspaceId}
                          jobId={job.id}
                          canRetry={job.canRetry}
                          canCancel={job.canCancel}
                        />
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="mt-4">
              <ListPagination
                newestHref={query.after ? searchHref(jobsPath, filterQuery) : null}
                olderHref={
                  jobsPage.nextCursor
                    ? searchHref(jobsPath, { ...filterQuery, after: jobsPage.nextCursor })
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
