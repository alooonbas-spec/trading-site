import Link from "next/link";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { canMutateWorkspaceData } from "@/lib/auth/permissions";
import { listPosts } from "@/services/posts/post-service";
import { listSocialAccounts } from "@/services/social-accounts/account-service";
import { CreatePostForm } from "@/components/posts/create-post-form";
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

export default async function PostsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const context = await requireWorkspaceContext(workspaceId);
  const canMutate = canMutateWorkspaceData(context.role);
  const [posts, accounts] = await Promise.all([listPosts(workspaceId), listSocialAccounts(workspaceId)]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Posts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          One post can target many social accounts. Publishing uses the shared job queue and each
          adapter. Unsupported platforms fail instead of reporting fake success.
        </p>
      </div>
      {canMutate ? (
        <Card>
          <CardHeader>
            <CardTitle>Compose</CardTitle>
            <CardDescription>Save a draft, then publish or schedule from the post page.</CardDescription>
          </CardHeader>
          <CardContent>
            <CreatePostForm workspaceId={workspaceId} accounts={accounts} />
          </CardContent>
        </Card>
      ) : null}
      {posts.length === 0 ? (
        <EmptyState title="No posts yet" description="Compose a post and choose one or more connected accounts." />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>All posts</CardTitle>
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
          </CardContent>
        </Card>
      )}
    </div>
  );
}
