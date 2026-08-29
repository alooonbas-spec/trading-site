import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { listWorkspaceMembersPage } from "@/services/workspaces/queries";
import { canManageMembers, canManageWorkspace } from "@/lib/auth/permissions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkspaceSettingsForm } from "@/components/settings/workspace-settings-form";
import { InviteMemberForm } from "@/components/settings/invite-member-form";
import { MembersTable } from "@/components/settings/members-table";
import { DeleteWorkspaceButton } from "@/components/settings/delete-workspace-button";
import { ListPagination } from "@/components/dashboard/list-pagination";
import { searchHref } from "@/lib/pagination/keyset";

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ after?: string }>;
}) {
  const { workspaceId } = await params;
  const query = await searchParams;
  const context = await requireWorkspaceContext(workspaceId);
  const membersPage = await listWorkspaceMembersPage(workspaceId, query.after);
  const members = membersPage.items;
  const settingsPath = `/w/${workspaceId}/settings`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Workspace, members, and roles.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Workspace</CardTitle>
          <CardDescription>Name is visible to every member of this workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          <WorkspaceSettingsForm
            workspaceId={workspaceId}
            currentName={context.workspace.name}
            canEdit={canManageWorkspace(context.role)}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>
            OWNER has full access. ADMIN manages accounts and members. OPERATOR runs day-to-day
            work. VIEWER is read-only. Showing {members.length} member{members.length === 1 ? "" : "s"} on
            this page. Older pages use a created_at keyset, not OFFSET.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <InviteMemberForm
            workspaceId={workspaceId}
            canInvite={canManageMembers(context.role)}
          />
          <MembersTable
            workspaceId={workspaceId}
            members={members}
            currentUserId={context.user.id}
            currentRole={context.role}
          />
          <ListPagination
            newestHref={query.after ? settingsPath : null}
            olderHref={
              membersPage.nextCursor ? searchHref(settingsPath, { after: membersPage.nextCursor }) : null
            }
          />
        </CardContent>
      </Card>
      {context.role === "OWNER" ? (
        <Card>
          <CardHeader>
            <CardTitle>Danger zone</CardTitle>
            <CardDescription>Deleting a workspace removes its membership and activity log.</CardDescription>
          </CardHeader>
          <CardContent>
            <DeleteWorkspaceButton workspaceId={workspaceId} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
