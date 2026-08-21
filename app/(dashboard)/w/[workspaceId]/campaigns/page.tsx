import Link from "next/link";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { canMutateWorkspaceData } from "@/lib/auth/permissions";
import { listCampaigns } from "@/services/campaigns/campaign-service";
import { listLeads } from "@/services/leads/lead-service";
import { listSocialAccounts } from "@/services/social-accounts/account-service";
import { CreateCampaignForm } from "@/components/campaigns/create-campaign-form";
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

export default async function CampaignsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const context = await requireWorkspaceContext(workspaceId);
  const canMutate = canMutateWorkspaceData(context.role);
  const [campaigns, leads, accounts] = await Promise.all([
    listCampaigns(workspaceId),
    listLeads({ workspaceId }),
    listSocialAccounts(workspaceId),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Campaigns enqueue per-account contact jobs. Workers skip do_not_contact leads, inoperable
          accounts, paused campaigns, and rate-limited accounts.
        </p>
      </div>
      {canMutate ? (
        <Card>
          <CardHeader>
            <CardTitle>New campaign</CardTitle>
            <CardDescription>
              Jobs are created when the campaign starts. INVITE/MESSAGE call adapters; they currently
              fail honestly until contact actions are enabled.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateCampaignForm workspaceId={workspaceId} leads={leads} accounts={accounts} />
          </CardContent>
        </Card>
      ) : null}
      {campaigns.length === 0 ? (
        <EmptyState
          title="No campaigns yet"
          description="Create a campaign with leads and connected social accounts."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>All campaigns</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Leads</TableHead>
                  <TableHead>Accounts</TableHead>
                  <TableHead>Queue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((campaign) => (
                  <TableRow key={campaign.id}>
                    <TableCell>
                      <Link
                        href={`/w/${workspaceId}/campaigns/${campaign.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {campaign.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{campaign.status}</Badge>
                    </TableCell>
                    <TableCell>{campaign.action}</TableCell>
                    <TableCell>{campaign.leadCount}</TableCell>
                    <TableCell>{campaign.accountCount}</TableCell>
                    <TableCell>{campaign.pendingJobCount}</TableCell>
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
