import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { canManageAccounts } from "@/lib/auth/permissions";
import { listSocialAccountHealthPage, listSocialAccounts } from "@/services/social-accounts/account-service";
import {
  parseSocialAccountPlatformFilter,
  parseSocialAccountStatusFilter,
} from "@/lib/social-accounts/filters";
import { listAccountGroups } from "@/services/social-accounts/group-service";
import { ConnectTelegramDialog } from "@/components/social-accounts/connect-telegram-dialog";
import { ConnectVkCommunityDialog } from "@/components/social-accounts/connect-vk-community-dialog";
import { ConnectOAuthButtons } from "@/components/social-accounts/connect-oauth-buttons";
import { SocialAccountCard } from "@/components/social-accounts/social-account-card";
import { CreateGroupForm } from "@/components/social-accounts/create-group-form";
import { AccountGroupList } from "@/components/social-accounts/account-group-list";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ListPagination } from "@/components/dashboard/list-pagination";
import { searchHref } from "@/lib/pagination/keyset";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SOCIAL_PLATFORM_LABELS, SOCIAL_PLATFORMS } from "@/types/social";
import { SOCIAL_ACCOUNT_STATUSES } from "@/types/status";

export default async function SocialAccountsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ connected?: string; after?: string; platform?: string; status?: string }>;
}) {
  const { workspaceId } = await params;
  const query = await searchParams;
  const context = await requireWorkspaceContext(workspaceId);
  const canManage = canManageAccounts(context.role);
  const platform = parseSocialAccountPlatformFilter(query.platform);
  const status = parseSocialAccountStatusFilter(query.status);
  const [healthPage, groups, pickerAccounts] = await Promise.all([
    listSocialAccountHealthPage({
      workspaceId,
      after: query.after,
      platform,
      status,
    }),
    listAccountGroups(workspaceId),
    canManage ? listSocialAccounts(workspaceId) : Promise.resolve([]),
  ]);
  const health = healthPage.items;
  const accountsPath = `/w/${workspaceId}/social-accounts`;
  const filterQuery = { platform, status };

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
              Telegram uses a BotFather token. VK user accounts, X, Instagram, and Facebook use
              OAuth. VK community messaging uses a community access key from Manage → API. Missing
              platform credentials return an error instead of a fake connection.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <ConnectTelegramDialog workspaceId={workspaceId} />
            <ConnectVkCommunityDialog workspaceId={workspaceId} />
            <ConnectOAuthButtons workspaceId={workspaceId} />
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">
          Only owners and admins can connect or disconnect accounts.
        </p>
      )}
      <form className="grid gap-2 md:grid-cols-2 xl:grid-cols-3" method="get">
        <select
          name="platform"
          defaultValue={platform ?? ""}
          className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
        >
          <option value="">All platforms</option>
          {SOCIAL_PLATFORMS.map((item) => (
            <option key={item} value={item}>
              {SOCIAL_PLATFORM_LABELS[item]}
            </option>
          ))}
        </select>
        <select
          name="status"
          defaultValue={status ?? ""}
          className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
        >
          <option value="">All account statuses</option>
          {SOCIAL_ACCOUNT_STATUSES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>
      {health.length === 0 ? (
        <EmptyState
          title="No social accounts match"
          description="Connect Telegram, VK, X, Instagram, or Facebook, or clear filters."
        />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Showing {health.length} account{health.length === 1 ? "" : "s"} on this page. Platform is account identity, not a business-logic switch. Older pages use a created_at keyset, not OFFSET.
          </p>
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
          <ListPagination
            newestHref={query.after ? searchHref(accountsPath, filterQuery) : null}
            olderHref={
              healthPage.nextCursor
                ? searchHref(accountsPath, { ...filterQuery, after: healthPage.nextCursor })
                : null
            }
          />
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
            <CreateGroupForm workspaceId={workspaceId} accounts={pickerAccounts} groups={groups} />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
