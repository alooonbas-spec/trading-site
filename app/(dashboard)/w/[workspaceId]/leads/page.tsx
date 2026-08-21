import Link from "next/link";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { canMutateWorkspaceData } from "@/lib/auth/permissions";
import { listLeads } from "@/services/leads/lead-service";
import { CreateLeadForm } from "@/components/leads/create-lead-form";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LEAD_STATUSES, type LeadStatus } from "@/types/status";

function parseStatus(value: string | undefined): LeadStatus | "all" {
  if (!value || value === "all") {
    return "all";
  }
  if ((LEAD_STATUSES as readonly string[]).includes(value)) {
    return value as LeadStatus;
  }
  return "all";
}

function parseDnc(value: string | undefined): "all" | "yes" | "no" {
  if (value === "yes" || value === "no") {
    return value;
  }
  return "all";
}

export default async function LeadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ q?: string; status?: string; dnc?: string }>;
}) {
  const { workspaceId } = await params;
  const query = await searchParams;
  const context = await requireWorkspaceContext(workspaceId);
  const canMutate = canMutateWorkspaceData(context.role);
  const status = parseStatus(query.status);
  const doNotContact = parseDnc(query.dnc);
  const leads = await listLeads({
    workspaceId,
    query: query.q,
    status,
    doNotContact,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          CRM people. Lead status, contact status, and do_not_contact are independent. The DNC flag
          exists only on the lead.
        </p>
      </div>
      <form className="grid gap-2 md:grid-cols-[1fr_180px_160px_auto]" method="get">
        <Input name="q" placeholder="Search name, email, phone" defaultValue={query.q ?? ""} />
        <select
          name="status"
          defaultValue={status}
          className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
        >
          <option value="all">All lead statuses</option>
          {LEAD_STATUSES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select
          name="dnc"
          defaultValue={doNotContact}
          className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
        >
          <option value="all">Any DNC</option>
          <option value="yes">Do not contact</option>
          <option value="no">Can contact</option>
        </select>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>
      {canMutate ? (
        <Card>
          <CardHeader>
            <CardTitle>New lead</CardTitle>
            <CardDescription>OPERATOR, ADMIN, and OWNER can create leads.</CardDescription>
          </CardHeader>
          <CardContent>
            <CreateLeadForm workspaceId={workspaceId} />
          </CardContent>
        </Card>
      ) : null}
      {leads.length === 0 ? (
        <EmptyState
          title="No leads match"
          description="Create a lead or clear filters. Merged leads are hidden from this list."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>People</CardTitle>
            <CardDescription>{leads.length} active leads in this workspace.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Lead status</TableHead>
                  <TableHead>DNC</TableHead>
                  <TableHead>Profiles</TableHead>
                  <TableHead>Email</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((lead) => (
                  <TableRow key={lead.id}>
                    <TableCell>
                      <Link
                        href={`/w/${workspaceId}/leads/${lead.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {lead.displayName}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{lead.status}</Badge>
                    </TableCell>
                    <TableCell>{lead.doNotContact ? "Yes" : "No"}</TableCell>
                    <TableCell>{lead.profileCount}</TableCell>
                    <TableCell>{lead.email ?? "—"}</TableCell>
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
