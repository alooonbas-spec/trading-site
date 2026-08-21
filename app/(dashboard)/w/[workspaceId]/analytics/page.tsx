import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { getWorkspaceAnalytics } from "@/services/analytics/analytics-service";
import { AnalyticsSection } from "@/components/analytics/analytics-section";

export default async function AnalyticsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  await requireWorkspaceContext(workspaceId);
  const analytics = await getWorkspaceAnalytics(workspaceId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Lead, contact, campaign, account, post, monitoring, and job-family metrics stay on their own
          machines. Totals are not mixed into a single success number.
        </p>
      </div>
      <AnalyticsSection
        title="Leads"
        description="LeadStatus of active records. do_not_contact is a lead flag, not a contact status."
        stats={[
          { title: "Active leads", value: String(analytics.leads.activeTotal) },
          { title: "Do not contact", value: String(analytics.leads.doNotContact), hint: "Flag on leads only" },
          { title: "Created today", value: String(analytics.leads.createdToday) },
          { title: "Created last 7 days", value: String(analytics.leads.createdLast7Days) },
        ]}
        counts={analytics.leads.byStatus}
      />
      <AnalyticsSection
        title="Contacts"
        description="ContactStatus of lead/account relationships. Separate from lead stage and job outcome."
        stats={[
          { title: "Replied", value: String(analytics.contacts.replied), hint: "Relationships currently REPLIED" },
          { title: "Contact jobs succeeded today", value: String(analytics.contacts.successfulJobsToday) },
          { title: "Contact jobs failed today", value: String(analytics.contacts.failedJobsToday) },
        ]}
        counts={analytics.contacts.byStatus}
      />
      <AnalyticsSection
        title="Campaigns"
        description="CampaignStatus only. Running campaigns are not counted as published posts or monitoring rules."
        stats={[{ title: "Running", value: String(analytics.campaigns.running) }]}
        counts={analytics.campaigns.byStatus}
      />
      <AnalyticsSection
        title="Social accounts"
        description="SocialAccountStatus of connected accounts in this workspace."
        stats={[{ title: "Accounts", value: String(analytics.accounts.total) }]}
        counts={analytics.accounts.byStatus}
      />
      <AnalyticsSection
        title="Posts"
        description="PostStatus of composed posts. Published today includes PUBLISHED and PARTIAL."
        stats={[{ title: "Published today", value: String(analytics.posts.publishedToday) }]}
        counts={analytics.posts.byStatus}
      />
      <AnalyticsSection
        title="Monitoring"
        description="MonitoringRuleStatus and stored events. Events are not counted as contact replies."
        stats={[
          { title: "Events today", value: String(analytics.monitoring.eventsToday) },
          { title: "Events last 7 days", value: String(analytics.monitoring.eventsLast7Days) },
        ]}
        counts={analytics.monitoring.rulesByStatus}
      />
      <AnalyticsSection
        title="CONTACT jobs"
        description="JobStatus for CONTACT jobs only."
        stats={[]}
        counts={analytics.jobs.contactByStatus}
      />
      <AnalyticsSection
        title="PUBLISH jobs"
        description="JobStatus for PUBLISH jobs only."
        stats={[]}
        counts={analytics.jobs.publishByStatus}
      />
      <AnalyticsSection
        title="MONITOR jobs"
        description="JobStatus for MONITOR jobs only."
        stats={[]}
        counts={analytics.jobs.monitorByStatus}
      />
    </div>
  );
}
