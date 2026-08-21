import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { canManageWorkspace, canMutateWorkspaceData } from "@/lib/auth/permissions";
import { getPost, listPostTargetsPage } from "@/services/posts/post-service";
import { listPostJobsPage } from "@/services/jobs/query-service";
import { listSocialAccountsByIds } from "@/services/social-accounts/account-service";
import { parseJobStatusFilter } from "@/lib/jobs/filters";
import { PostControls } from "@/components/posts/post-controls";
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

export default async function PostDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; postId: string }>;
  searchParams: Promise<{ after?: string; targets?: string; status?: string }>;
}) {
  const { workspaceId, postId } = await params;
  const query = await searchParams;
  const context = await requireWorkspaceContext(workspaceId);
  const status = parseJobStatusFilter(query.status);

  let post;
  try {
    post = await getPost(workspaceId, postId);
  } catch (error) {
    if (error instanceof ValidationError) {
      notFound();
    }
    throw error;
  }

  const [targetsPage, jobsPage] = await Promise.all([
    listPostTargetsPage(workspaceId, postId, query.targets),
    listPostJobsPage(workspaceId, postId, { after: query.after, status }),
  ]);
  const jobs = jobsPage.items;
  const targets = targetsPage.items;
  const accountIds = [
    ...targets.map((target) => target.socialAccountId),
    ...jobs.map((job) => job.socialAccountId).filter((id): id is string => id !== null),
  ];
  const accounts = await listSocialAccountsByIds(workspaceId, accountIds);
  const accountMap = new Map(accounts.map((account) => [account.id, account]));
  const postPath = `/w/${workspaceId}/posts/${postId}`;
  const filterQuery = { status, targets: query.targets };

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/w/${workspaceId}/posts`} className="text-sm text-muted-foreground hover:underline">
          Back to posts
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Post</h1>
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge variant="secondary">{post.status}</Badge>
          {post.scheduledAt ? <Badge variant="outline">scheduled</Badge> : null}
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Body</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="whitespace-pre-wrap text-sm">{post.body}</p>
          {post.media.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {post.media.map((url) => (
                <li key={url}>
                  <a href={url} className="underline" target="_blank" rel="noreferrer">
                    {url}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Controls</CardTitle>
          <CardDescription>
            Publish enqueues one PUBLISH job per target account. Process queue claims jobs with SKIP
            LOCKED.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PostControls
            workspaceId={workspaceId}
            post={post}
            canMutate={canMutateWorkspaceData(context.role)}
            canDelete={canManageWorkspace(context.role)}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Targets</CardTitle>
          <CardDescription>
            {post.publishedTargetCount} published · {post.failedTargetCount} failed · {post.targetCount}{" "}
            total. Older pages use a created_at keyset, not OFFSET. PostTargetStatus stays on its own
            machine.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {targets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No targets on this page.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>External id</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {targets.map((target) => {
                  const account = accountMap.get(target.socialAccountId);
                  return (
                    <TableRow key={target.id}>
                      <TableCell>
                        {account
                          ? `${SOCIAL_PLATFORM_LABELS[account.platform]} ${account.username ?? account.externalAccountId}`
                          : target.socialAccountId}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{target.status}</Badge>
                      </TableCell>
                      <TableCell>{target.externalPostId ?? "—"}</TableCell>
                      <TableCell className="max-w-xs truncate">{target.lastError ?? "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          <div className="mt-4">
            <ListPagination
              newestHref={query.targets ? searchHref(postPath, { after: query.after, status }) : null}
              olderHref={
                targetsPage.nextCursor
                  ? searchHref(postPath, {
                      after: query.after,
                      status,
                      targets: targetsPage.nextCursor,
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
            {query.targets ? <input type="hidden" name="targets" value={query.targets} /> : null}
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
              {status ? "No jobs match this JobStatus." : "No jobs yet. Publish the post to enqueue work."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => {
                  const account = job.socialAccountId ? accountMap.get(job.socialAccountId) : undefined;
                  return (
                    <TableRow key={job.id}>
                      <TableCell>
                        {account ? SOCIAL_PLATFORM_LABELS[account.platform] : (job.socialAccountId ?? "—")}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{job.status}</Badge>
                      </TableCell>
                      <TableCell>
                        {job.attempts}/{job.maxAttempts}
                      </TableCell>
                      <TableCell className="max-w-xs truncate">{job.lastError ?? "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          <div className="mt-4">
            <ListPagination
              newestHref={query.after ? searchHref(postPath, filterQuery) : null}
              olderHref={
                jobsPage.nextCursor
                  ? searchHref(postPath, { ...filterQuery, after: jobsPage.nextCursor })
                  : null
              }
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
