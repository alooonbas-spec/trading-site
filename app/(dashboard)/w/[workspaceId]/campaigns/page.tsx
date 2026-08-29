import Link from "next/link";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { canMutateWorkspaceData } from "@/lib/auth/permissions";
import { listCampaignsPage } from "@/services/campaigns/campaign-service";
import { parseCampaignStatusFilter } from "@/lib/campaigns/filters";
import { searchPickerLeads } from "@/services/leads/lead-service";
import { searchPickerAccounts } from "@/services/social-accounts/account-service";
import { CreateCampaignForm } from "@/components/campaigns/create-campaign-form";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ListPagination } from "@/components/dashboard/list-pagination";
import { searchHref } from "@/lib/pagination/keyset";
import { toPickerLead } from "@/lib/leads/picker";
import { toPickerAccount } from "@/lib/social-accounts/picker";
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
import { CAMPAIGN_STATUSES } from "@/types/status";

export default async function CampaignsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ after?: string; status?: string }>;
}) {
  const { workspaceId } = await params;
  const query = await searchParams;
  const context = await requireWorkspaceContext(workspaceId);
  const canMutate = canMutateWorkspaceData(context.role);
  const status = parseCampaignStatusFilter(query.status);
  const [campaignsPage, picker, accounts] = await Promise.all([
    listCampaignsPage(workspaceId, { after: query.after, status }),
    searchPickerLeads(workspaceId),
    searchPickerAccounts(workspaceId),
  ]);
  const campaigns = campaignsPage.items;
  const campaignsPath = `/w/${workspaceId}/campaigns`;
  const filterQuery = { status };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Campaigns enqueue per-account contact jobs. Workers skip do_not_contact leads, inoperable
          accounts, paused campaigns, and rate-limited accounts.
        </p>
      </div>
      <form className="grid gap-2 md:grid-cols-[220px_auto]" method="get">
        <select
          name="status"
          defaultValue={status ?? ""}
          className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
        >
          <option value="">All campaign statuses</option>
          {CAMPAIGN_STATUSES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>
      {canMutate ? (
        <Card>
          <CardHeader>
            <CardTitle>New campaign</CardTitle>
            <CardDescription>
              Jobs are created when the campaign starts. MESSAGE enqueues only for accounts whose
              adapter reports messaging, including VK community tokens. INVITE currently enqueues for
              nobody. Lead and account pickers show the newest 200 matches.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateCampaignForm
              workspaceId={workspaceId}
              initialLeads={picker.items.map(toPickerLead)}
              initialHasMore={picker.hasMore}
              initialAccounts={accounts.items.map(toPickerAccount)}
              initialAccountsHasMore={accounts.hasMore}
            />
          </CardContent>
        </Card>
      ) : null}
      {campaigns.length === 0 ? (
        <EmptyState
          title="No campaigns match"
          description="Create a campaign with leads and connected social accounts, or clear the status filter."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>All campaigns</CardTitle>
            <CardDescription>
              Showing {campaigns.length} campaign{campaigns.length === 1 ? "" : "s"} on this page. Older
              pages use a created_at keyset, not OFFSET.
            </CardDescription>
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
            <div className="mt-4">
              <ListPagination
                newestHref={query.after ? searchHref(campaignsPath, filterQuery) : null}
                olderHref={
                  campaignsPage.nextCursor
                    ? searchHref(campaignsPath, { ...filterQuery, after: campaignsPage.nextCursor })
                    : null
                }
              />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
