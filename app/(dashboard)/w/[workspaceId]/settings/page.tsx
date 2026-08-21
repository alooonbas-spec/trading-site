import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { listWorkspaceMembers } from "@/services/workspaces/queries";
import { canManageMembers, canManageWorkspace } from "@/lib/auth/permissions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkspaceSettingsForm } from "@/components/settings/workspace-settings-form";
import { InviteMemberForm } from "@/components/settings/invite-member-form";
import { MembersTable } from "@/components/settings/members-table";
import { DeleteWorkspaceButton } from "@/components/settings/delete-workspace-button";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const context = await requireWorkspaceContext(workspaceId);
  const members = await listWorkspaceMembers(workspaceId);

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
            work. VIEWER is read-only.
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
