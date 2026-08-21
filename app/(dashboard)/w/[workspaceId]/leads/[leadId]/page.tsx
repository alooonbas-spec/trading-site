import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { canManageWorkspace, canMutateWorkspaceData } from "@/lib/auth/permissions";
import { findLead, listLeads } from "@/services/leads/lead-service";
import { listSocialProfiles } from "@/services/leads/profile-service";
import { listContactRelationships } from "@/services/leads/relationship-service";
import { listLeadInteractions } from "@/services/leads/interaction-service";
import { listSocialAccounts } from "@/services/social-accounts/account-service";
import { listInboxEventsForLead } from "@/services/inbox/query-service";
import { ListPagination } from "@/components/dashboard/list-pagination";
import { searchHref } from "@/lib/pagination/keyset";
import { EditLeadForm } from "@/components/leads/edit-lead-form";
import { CreateProfileForm } from "@/components/leads/create-profile-form";
import { CreateRelationshipForm } from "@/components/leads/create-relationship-form";
import { RelationshipList } from "@/components/leads/relationship-list";
import { InteractionTimeline } from "@/components/leads/interaction-timeline";
import { MergeLeadForm } from "@/components/leads/merge-lead-form";
import { DeleteLeadButton } from "@/components/leads/delete-lead-button";
import { CollectPublicProfileForm } from "@/components/leads/collect-public-profile-form";
import { LeadInboxEvents } from "@/components/inbox/lead-inbox-events";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SOCIAL_PLATFORM_LABELS } from "@/types/social";
import { isTinyFishConfigured } from "@/lib/tinyfish/config";

export default async function LeadDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; leadId: string }>;
  searchParams: Promise<{ inbox?: string; timeline?: string }>;
}) {
  const { workspaceId, leadId } = await params;
  const query = await searchParams;
  const context = await requireWorkspaceContext(workspaceId);
  const lead = await findLead(workspaceId, leadId);
  if (!lead) {
    notFound();
  }

  const canMutate = canMutateWorkspaceData(context.role) && !lead.mergedIntoId;
  const collectionEnabled = isTinyFishConfigured();
  const [profiles, relationships, interactionPage, accounts, others, inboxPage] = await Promise.all([
    listSocialProfiles(workspaceId, leadId),
    listContactRelationships(workspaceId, leadId),
    listLeadInteractions(workspaceId, leadId, query.timeline),
    listSocialAccounts(workspaceId),
    canMutate ? listLeads({ workspaceId }) : Promise.resolve([]),
    listInboxEventsForLead(workspaceId, leadId, query.inbox),
  ]);
  const mergeCandidates = others.filter((item) => item.id !== lead.id);
  const leadPath = `/w/${workspaceId}/leads/${leadId}`;
  const inboxEvents = inboxPage.items;
  const interactions = interactionPage.items;

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/w/${workspaceId}/leads`} className="text-sm text-muted-foreground hover:underline">
          Back to leads
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{lead.displayName}</h1>
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge variant="secondary">{lead.status}</Badge>
          {lead.doNotContact ? <Badge variant="destructive">do_not_contact</Badge> : null}
        </div>
      </div>
      {lead.mergedIntoId ? (
        <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
          This lead was merged into{" "}
          <Link className="underline" href={`/w/${workspaceId}/leads/${lead.mergedIntoId}`}>
            the surviving lead
          </Link>
          . It is read-only.
        </p>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Lead</CardTitle>
          <CardDescription>
            Lead status is the CRM stage. It is not the contact status of a profile/account pair.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {canMutate ? (
            <EditLeadForm workspaceId={workspaceId} lead={lead} />
          ) : (
            <dl className="grid gap-3 text-sm md:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Email</dt>
                <dd>{lead.email ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Phone</dt>
                <dd>{lead.phone ?? "—"}</dd>
              </div>
              <div className="md:col-span-2">
                <dt className="text-muted-foreground">Notes</dt>
                <dd>{lead.notes ?? "—"}</dd>
              </div>
            </dl>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Social profiles</CardTitle>
          <CardDescription>One lead can have many profiles across platforms.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {profiles.length === 0 ? (
            <p className="text-sm text-muted-foreground">No profiles linked yet.</p>
          ) : (
            <ul className="space-y-2">
              {profiles.map((profile) => (
                <li key={profile.id} className="rounded-lg border border-border px-3 py-2 text-sm">
                  {SOCIAL_PLATFORM_LABELS[profile.platform]} {profile.username ?? profile.externalProfileId}
                  {profile.profileUrl ? (
                    <>
                      {" · "}
                      <a href={profile.profileUrl} className="underline" target="_blank" rel="noreferrer">
                        Open
                      </a>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {canMutate ? (
            <div className="space-y-6">
              <CreateProfileForm workspaceId={workspaceId} leadId={lead.id} />
              <div className="space-y-2">
                <p className="text-sm font-medium">Collect from a public profile</p>
                <p className="text-sm text-muted-foreground">
                  Uses TinyFish Fetch on an official public URL. Captcha bypass and stealth retries are
                  disabled.
                </p>
                <CollectPublicProfileForm
                  workspaceId={workspaceId}
                  leadId={lead.id}
                  enabled={collectionEnabled}
                />
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Contact relationships</CardTitle>
          <CardDescription>
            Each relationship is one (lead, their profile, our account) pair with its own ContactStatus.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <RelationshipList
            workspaceId={workspaceId}
            leadId={lead.id}
            relationships={relationships}
            profiles={profiles}
            accounts={accounts}
            canMutate={canMutate}
          />
          {canMutate ? (
            <CreateRelationshipForm
              workspaceId={workspaceId}
              leadId={lead.id}
              profiles={profiles}
              accounts={accounts}
            />
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Inbox replies</CardTitle>
          <CardDescription>
            Matched inbound events for this lead. Unmatched senders are attached from Inbox, never
            auto-created as new people. Official replies are blocked when the lead is do_not_contact.
            Older pages use a created_at keyset, not OFFSET.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <LeadInboxEvents events={inboxEvents} canMutate={canMutate} />
          <ListPagination
            newestHref={query.inbox ? searchHref(leadPath, { timeline: query.timeline }) : null}
            olderHref={
              inboxPage.nextCursor
                ? searchHref(leadPath, { inbox: inboxPage.nextCursor, timeline: query.timeline })
                : null
            }
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Interactions</CardTitle>
          <CardDescription>
            Notes, status changes, profile links, and merges. Older pages use a created_at keyset, not OFFSET.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <InteractionTimeline
            workspaceId={workspaceId}
            leadId={lead.id}
            interactions={interactions}
            canMutate={canMutate}
          />
          <ListPagination
            newestHref={query.timeline ? searchHref(leadPath, { inbox: query.inbox }) : null}
            olderHref={
              interactionPage.nextCursor
                ? searchHref(leadPath, { inbox: query.inbox, timeline: interactionPage.nextCursor })
                : null
            }
          />
        </CardContent>
      </Card>
      {canMutate ? (
        <Card>
          <CardHeader>
            <CardTitle>Merge</CardTitle>
            <CardDescription>The selected lead is absorbed into this one and archived.</CardDescription>
          </CardHeader>
          <CardContent>
            <MergeLeadForm workspaceId={workspaceId} targetLead={lead} candidates={mergeCandidates} />
          </CardContent>
        </Card>
      ) : null}
      {canManageWorkspace(context.role) && !lead.mergedIntoId ? (
        <Card>
          <CardHeader>
            <CardTitle>Danger zone</CardTitle>
            <CardDescription>Only owners and admins can delete a lead.</CardDescription>
          </CardHeader>
          <CardContent>
            <DeleteLeadButton workspaceId={workspaceId} leadId={lead.id} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
