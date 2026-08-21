import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { canManageWorkspace, canMutateWorkspaceData } from "@/lib/auth/permissions";
import {
  getCampaign,
  listCampaignAccountIds,
  listCampaignLeadIds,
} from "@/services/campaigns/campaign-service";
import { listCampaignJobs } from "@/services/jobs/worker-service";
import { listLeads } from "@/services/leads/lead-service";
import { listSocialAccounts } from "@/services/social-accounts/account-service";
import { CampaignControls } from "@/components/campaigns/campaign-controls";
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

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ workspaceId: string; campaignId: string }>;
}) {
  const { workspaceId, campaignId } = await params;
  const context = await requireWorkspaceContext(workspaceId);

  let campaign;
  try {
    campaign = await getCampaign(workspaceId, campaignId);
  } catch (error) {
    if (error instanceof ValidationError) {
      notFound();
    }
    throw error;
  }

  const [leadIds, accountIds, jobs, leads, accounts] = await Promise.all([
    listCampaignLeadIds(workspaceId, campaignId),
    listCampaignAccountIds(workspaceId, campaignId),
    listCampaignJobs(workspaceId, campaignId),
    listLeads({ workspaceId, includeMerged: true }),
    listSocialAccounts(workspaceId),
  ]);

  const leadMap = new Map(leads.map((lead) => [lead.id, lead]));
  const accountMap = new Map(accounts.map((account) => [account.id, account]));

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
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {leadIds.map((id) => {
              const lead = leadMap.get(id);
              return (
                <p key={id}>
                  {lead ? (
                    <Link className="underline-offset-4 hover:underline" href={`/w/${workspaceId}/leads/${id}`}>
                      {lead.displayName}
                    </Link>
                  ) : (
                    id
                  )}
                  {lead?.doNotContact ? " · DNC" : ""}
                </p>
              );
            })}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Accounts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {accountIds.map((id) => {
              const account = accountMap.get(id);
              return (
                <p key={id}>
                  {account
                    ? `${SOCIAL_PLATFORM_LABELS[account.platform]} ${account.username ?? account.externalAccountId}`
                    : id}
                </p>
              );
            })}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Jobs</CardTitle>
          <CardDescription>{jobs.length} queued or finished contact jobs.</CardDescription>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No jobs yet. Start the campaign to enqueue work.</p>
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
                {jobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell>{leadMap.get(job.leadId)?.displayName ?? job.leadId}</TableCell>
                    <TableCell>
                      {(() => {
                        const account = accountMap.get(job.socialAccountId);
                        return account
                          ? SOCIAL_PLATFORM_LABELS[account.platform]
                          : job.socialAccountId;
                      })()}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{job.status}</Badge>
                    </TableCell>
                    <TableCell>
                      {job.attempts}/{job.maxAttempts}
                    </TableCell>
                    <TableCell className="max-w-xs truncate">{job.lastError ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
