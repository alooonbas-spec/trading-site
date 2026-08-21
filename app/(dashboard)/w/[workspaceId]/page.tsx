import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { countTodayActivity, countWorkspaceMembers } from "@/services/workspaces/queries";
import { countSocialAccounts } from "@/services/social-accounts/account-service";
import { countNewLeadsToday } from "@/services/leads/lead-service";
import { countRunningCampaigns } from "@/services/campaigns/campaign-service";
import { countSuccessfulContactJobsToday } from "@/services/jobs/worker-service";
import { countPublishedPostsToday } from "@/services/posts/post-service";
import { countMonitoringEventsToday } from "@/services/monitoring/rule-service";
import { StatCard } from "@/components/dashboard/stat-card";
import { EmptyState } from "@/components/dashboard/empty-state";

export default async function WorkspaceDashboardPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const context = await requireWorkspaceContext(workspaceId);
  const [memberCount, actionsToday, accountCount, newLeadsToday, runningCampaigns, successfulActions, postsToday, monitoringEventsToday] =
    await Promise.all([
      countWorkspaceMembers(workspaceId),
      countTodayActivity(workspaceId),
      countSocialAccounts(workspaceId),
      countNewLeadsToday(workspaceId),
      countRunningCampaigns(workspaceId),
      countSuccessfulContactJobsToday(workspaceId),
      countPublishedPostsToday(workspaceId),
      countMonitoringEventsToday(workspaceId),
    ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {context.workspace.name} · {context.role}
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Members" value={String(memberCount)} hint="People in this workspace" />
        <StatCard title="Social accounts" value={String(accountCount)} hint="Connected and disconnected accounts" />
        <StatCard title="Actions today" value={String(actionsToday)} hint="Workspace activity log" />
        <StatCard title="New leads" value={String(newLeadsToday)} hint="Created today, excluding merged records" />
        <StatCard title="Active campaigns" value={String(runningCampaigns)} hint="Campaigns currently RUNNING" />
        <StatCard title="Successful actions" value={String(successfulActions)} hint="Contact jobs completed today" />
        <StatCard title="Posts today" value={String(postsToday)} hint="Posts that reached PUBLISHED or PARTIAL today" />
        <StatCard title="Monitoring events" value={String(monitoringEventsToday)} hint="Events stored today" />
        <StatCard title="Replies" value="—" hint="Contact metrics appear after PHASE 3" />
      </div>
      <EmptyState
        title={accountCount === 0 ? "Connect a social account" : "Workspace is ready"}
        description={
          accountCount === 0
            ? "Open Social Accounts to connect Telegram, VK, X, Instagram, or Facebook. One workspace can hold many accounts per platform."
            : `${accountCount} social account${accountCount === 1 ? "" : "s"} in this workspace.`
        }
      />
    </div>
  );
}
