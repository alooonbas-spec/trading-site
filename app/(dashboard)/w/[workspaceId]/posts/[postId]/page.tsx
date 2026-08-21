import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { canManageWorkspace, canMutateWorkspaceData } from "@/lib/auth/permissions";
import { getPost, listPostTargets } from "@/services/posts/post-service";
import { listPostJobs } from "@/services/jobs/worker-service";
import { listSocialAccounts } from "@/services/social-accounts/account-service";
import { PostControls } from "@/components/posts/post-controls";
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

export default async function PostDetailPage({
  params,
}: {
  params: Promise<{ workspaceId: string; postId: string }>;
}) {
  const { workspaceId, postId } = await params;
  const context = await requireWorkspaceContext(workspaceId);

  let post;
  try {
    post = await getPost(workspaceId, postId);
  } catch (error) {
    if (error instanceof ValidationError) {
      notFound();
    }
    throw error;
  }

  const [targets, jobs, accounts] = await Promise.all([
    listPostTargets(workspaceId, postId),
    listPostJobs(workspaceId, postId),
    listSocialAccounts(workspaceId),
  ]);
  const accountMap = new Map(accounts.map((account) => [account.id, account]));

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
            total
          </CardDescription>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Jobs</CardTitle>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No jobs yet. Publish the post to enqueue work.</p>
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
                  const account = accountMap.get(job.socialAccountId);
                  return (
                    <TableRow key={job.id}>
                      <TableCell>
                        {account ? SOCIAL_PLATFORM_LABELS[account.platform] : job.socialAccountId}
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
        </CardContent>
      </Card>
    </div>
  );
}
