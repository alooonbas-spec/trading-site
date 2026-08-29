import Link from "next/link";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { canMutateWorkspaceData } from "@/lib/auth/permissions";
import { listPostsPage } from "@/services/posts/post-service";
import { parsePostStatusFilter } from "@/lib/posts/filters";
import { searchPickerAccounts } from "@/services/social-accounts/account-service";
import { CreatePostForm } from "@/components/posts/create-post-form";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ListPagination } from "@/components/dashboard/list-pagination";
import { searchHref } from "@/lib/pagination/keyset";
import { toPickerAccount } from "@/lib/social-accounts/picker";
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
import { POST_STATUSES } from "@/types/status";

export default async function PostsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ after?: string; status?: string }>;
}) {
  const { workspaceId } = await params;
  const query = await searchParams;
  const context = await requireWorkspaceContext(workspaceId);
  const canMutate = canMutateWorkspaceData(context.role);
  const status = parsePostStatusFilter(query.status);
  const [postsPage, accounts] = await Promise.all([
    listPostsPage(workspaceId, { after: query.after, status }),
    searchPickerAccounts(workspaceId),
  ]);
  const posts = postsPage.items;
  const postsPath = `/w/${workspaceId}/posts`;
  const filterQuery = { status };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Posts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          One post can target many social accounts. Publishing uses the shared job queue and each
          adapter. Unsupported platforms fail instead of reporting fake success.
        </p>
      </div>
      <form className="grid gap-2 md:grid-cols-[220px_auto]" method="get">
        <select
          name="status"
          defaultValue={status ?? ""}
          className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
        >
          <option value="">All post statuses</option>
          {POST_STATUSES.map((item) => (
            <option key={item} value={item}>
              {item}
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
            <CardTitle>Compose</CardTitle>
            <CardDescription>Save a draft, then publish or schedule from the post page.</CardDescription>
          </CardHeader>
          <CardContent>
            <CreatePostForm
              workspaceId={workspaceId}
              initialAccounts={accounts.items.map(toPickerAccount)}
              initialHasMore={accounts.hasMore}
            />
          </CardContent>
        </Card>
      ) : null}
      {posts.length === 0 ? (
        <EmptyState
          title="No posts match"
          description="Compose a post and choose one or more connected accounts, or clear the status filter."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>All posts</CardTitle>
            <CardDescription>
              Showing {posts.length} post{posts.length === 1 ? "" : "s"} on this page. Older pages use a
              created_at keyset, not OFFSET.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Preview</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Targets</TableHead>
                  <TableHead>Published</TableHead>
                  <TableHead>Scheduled</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {posts.map((post) => (
                  <TableRow key={post.id}>
                    <TableCell>
                      <Link
                        href={`/w/${workspaceId}/posts/${post.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {post.body.slice(0, 80)}
                        {post.body.length > 80 ? "…" : ""}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{post.status}</Badge>
                    </TableCell>
                    <TableCell>{post.targetCount}</TableCell>
                    <TableCell>{post.publishedTargetCount}</TableCell>
                    <TableCell>
                      {post.scheduledAt ? new Date(post.scheduledAt).toLocaleString() : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="mt-4">
              <ListPagination
                newestHref={query.after ? searchHref(postsPath, filterQuery) : null}
                olderHref={
                  postsPage.nextCursor
                    ? searchHref(postsPath, { ...filterQuery, after: postsPage.nextCursor })
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
