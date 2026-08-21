import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { canManageWorkspace, canMutateWorkspaceData } from "@/lib/auth/permissions";
import { getCampaign, listCampaignAccountIds, listCampaignLeadsPage } from "@/services/campaigns/campaign-service";
import { listCampaignJobsPage } from "@/services/jobs/query-service";
import { listLeadsByIds } from "@/services/leads/lead-service";
import { listSocialAccountsByIds } from "@/services/social-accounts/account-service";
import { parseJobStatusFilter } from "@/lib/jobs/filters";
import { CampaignControls } from "@/components/campaigns/campaign-controls";
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

export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; campaignId: string }>;
  searchParams: Promise<{ after?: string; leads?: string; status?: string }>;
}) {
  const { workspaceId, campaignId } = await params;
  const query = await searchParams;
  const context = await requireWorkspaceContext(workspaceId);
  const status = parseJobStatusFilter(query.status);

  let campaign;
  try {
    campaign = await getCampaign(workspaceId, campaignId);
  } catch (error) {
    if (error instanceof ValidationError) {
      notFound();
    }
    throw error;
  }

  const [leadsPage, accountIds, jobsPage] = await Promise.all([
    listCampaignLeadsPage(workspaceId, campaignId, query.leads),
    listCampaignAccountIds(workspaceId, campaignId),
    listCampaignJobsPage(workspaceId, campaignId, { after: query.after, status }),
  ]);
  const jobs = jobsPage.items;
  const campaignLeads = leadsPage.items;
  const jobLeadIds = jobs
    .map((job) => job.leadId)
    .filter((id): id is string => id !== null)
    .filter((id) => !campaignLeads.some((lead) => lead.id === id));
  const jobAccountIds = jobs
    .map((job) => job.socialAccountId)
    .filter((id): id is string => id !== null);
  const [jobLeads, accounts] = await Promise.all([
    listLeadsByIds(workspaceId, jobLeadIds),
    listSocialAccountsByIds(workspaceId, [...accountIds, ...jobAccountIds]),
  ]);
  const leadMap = new Map([...campaignLeads, ...jobLeads].map((lead) => [lead.id, lead]));
  const accountMap = new Map(accounts.map((account) => [account.id, account]));
  const campaignPath = `/w/${workspaceId}/campaigns/${campaignId}`;

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/w/${workspaceId}/campaigns`} className="text-sm text-muted-foreground hover:underline">
          Back to campaigns
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{campaign.name}</h1>
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge variant="secondary">{campaign.status}</Badge>
          <Badge variant="outline">{campaign.action}</Badge>
        </div>
        {campaign.description ? (
          <p className="mt-2 text-sm text-muted-foreground">{campaign.description}</p>
        ) : null}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Controls</CardTitle>
          <CardDescription>
            Start enqueues jobs. Process queue claims PENDING/RETRY jobs with SKIP LOCKED.
            A background worker can also claim due jobs across workspaces.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CampaignControls
            workspaceId={workspaceId}
            campaign={campaign}
            canMutate={canMutateWorkspaceData(context.role)}
            canDelete={canManageWorkspace(context.role)}
          />
        </CardContent>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Leads</CardTitle>
            <CardDescription>
              {campaign.leadCount} selected. This page does not load the whole CRM. Older pages use a
              created_at keyset, not OFFSET.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {campaignLeads.length === 0 ? (
              <p className="text-muted-foreground">No leads on this page.</p>
            ) : (
              campaignLeads.map((lead) => (
                <p key={lead.id}>
                  <Link
                    className="underline-offset-4 hover:underline"
                    href={`/w/${workspaceId}/leads/${lead.id}`}
                  >
                    {lead.displayName}
                  </Link>
                  {lead.doNotContact ? " · DNC" : ""}
                </p>
              ))
            )}
            <ListPagination
              newestHref={query.leads ? searchHref(campaignPath, { after: query.after, status }) : null}
              olderHref={
                leadsPage.nextCursor
                  ? searchHref(campaignPath, {
                      after: query.after,
                      status,
                      leads: leadsPage.nextCursor,
                    })
                  : null
              }
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Accounts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {accountIds.length === 0 ? (
              <p className="text-muted-foreground">No accounts selected.</p>
            ) : (
              accountIds.map((id) => {
                const account = accountMap.get(id);
                return (
                  <p key={id}>
                    {account
                      ? `${SOCIAL_PLATFORM_LABELS[account.platform]} ${account.username ?? account.externalAccountId}`
                      : id}
                  </p>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Jobs</CardTitle>
          <CardDescription>
            Showing {jobs.length} job{jobs.length === 1 ? "" : "s"} on this page. Retry stays on the Jobs
            queue and does not rewrite LeadStatus or do_not_contact. JobStatus stays on its own machine.
            Older pages use a created_at keyset, not OFFSET.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="mb-4 grid gap-2 md:grid-cols-[220px_auto]" method="get">
            {query.leads ? <input type="hidden" name="leads" value={query.leads} /> : null}
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
              {status
                ? "No jobs match this JobStatus."
                : "No jobs yet. Start the campaign to enqueue work."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lead</TableHead>
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
                        {job.leadId ? (leadMap.get(job.leadId)?.displayName ?? job.leadId) : "—"}
                      </TableCell>
                      <TableCell>
                        {account
                          ? SOCIAL_PLATFORM_LABELS[account.platform]
                          : (job.socialAccountId ?? "—")}
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
              newestHref={query.after ? searchHref(campaignPath, { leads: query.leads, status }) : null}
              olderHref={
                jobsPage.nextCursor
                  ? searchHref(campaignPath, {
                      after: jobsPage.nextCursor,
                      leads: query.leads,
                      status,
                    })
                  : null
              }
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
