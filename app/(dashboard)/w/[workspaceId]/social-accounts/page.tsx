import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { canManageAccounts } from "@/lib/auth/permissions";
import { listSocialAccountHealth } from "@/services/social-accounts/account-service";
import { listAccountGroups } from "@/services/social-accounts/group-service";
import { ConnectTelegramDialog } from "@/components/social-accounts/connect-telegram-dialog";
import { ConnectOAuthButtons } from "@/components/social-accounts/connect-oauth-buttons";
import { SocialAccountCard } from "@/components/social-accounts/social-account-card";
import { CreateGroupForm } from "@/components/social-accounts/create-group-form";
import { AccountGroupList } from "@/components/social-accounts/account-group-list";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function SocialAccountsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ connected?: string }>;
}) {
  const { workspaceId } = await params;
  const query = await searchParams;
  const context = await requireWorkspaceContext(workspaceId);
  const canManage = canManageAccounts(context.role);
  const [health, groups] = await Promise.all([
    listSocialAccountHealth(workspaceId),
    listAccountGroups(workspaceId),
  ]);
  const accounts = health.map((item) => item.account);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Social Accounts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          One workspace can hold many accounts per platform. Tokens stay on the server.
        </p>
      </div>
      {query.connected === "1" ? (
        <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
          Account connected.
        </p>
      ) : null}
      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Connect an account</CardTitle>
            <CardDescription>
              Telegram uses a BotFather token. VK, X, Instagram, and Facebook use OAuth. Missing
              platform credentials return an error instead of a fake connection.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <ConnectTelegramDialog workspaceId={workspaceId} />
            <ConnectOAuthButtons workspaceId={workspaceId} />
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">
          Only owners and admins can connect or disconnect accounts.
        </p>
      )}
      {health.length === 0 ? (
        <EmptyState
          title="No social accounts yet"
          description="Connect Telegram, VK, X, Instagram, or Facebook to start managing this workspace."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {health.map((item) => (
            <SocialAccountCard
              key={item.account.id}
              health={item}
              workspaceId={workspaceId}
              canManage={canManage}
            />
          ))}
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Account groups</CardTitle>
          <CardDescription>
            Groups are a convenience for selecting many accounts. They do not change permissions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <AccountGroupList workspaceId={workspaceId} groups={groups} canManage={canManage} />
          {canManage ? (
            <CreateGroupForm workspaceId={workspaceId} accounts={accounts} groups={groups} />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
