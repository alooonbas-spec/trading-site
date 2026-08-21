import { createClient } from "@/lib/supabase/server";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { assertCanMutateWorkspaceData } from "@/lib/auth/permissions";
import { UnsupportedActionError, ValidationError } from "@/lib/errors";
import { resolveInboxReplyKind } from "@/lib/inbox/reply-kind";
import { replyInboxEventSchema } from "@/lib/validation/lead";
import { logActivity } from "@/services/activity/activity-service";
import { getInboxEvent } from "@/services/inbox/query-service";
import { assertCanContactLead } from "@/services/leads/do-not-contact";
import { recordLeadInteraction } from "@/services/leads/interaction-service";
import { assertLeadMutable, getLead } from "@/services/leads/lead-service";
import { takeAccountAdapterRate } from "@/services/social-accounts/rate-limit-service";
import { prepareAccountAdapter } from "@/services/social-accounts/token-refresh-service";
import { SOCIAL_ACCOUNT_PUBLIC_COLUMNS } from "@/types/social-account";
import type { ContactStatus } from "@/types/status";
import type { SocialPlatform } from "@/types/social";

export async function replyToInboxEvent(input: {
  workspaceId: string;
  inboxEventId: string;
  body: string;
}): Promise<{ externalMessageId: string; leadId: string | null }> {
  const context = await requireWorkspaceContext(input.workspaceId);
  assertCanMutateWorkspaceData(context.role);
  const parsed = replyInboxEventSchema.parse({
    inboxEventId: input.inboxEventId,
    body: input.body,
  });

  const event = await getInboxEvent(input.workspaceId, parsed.inboxEventId);
  const supabase = await createClient();
  const { data: account, error: accountError } = await supabase
    .from("social_accounts")
    .select(SOCIAL_ACCOUNT_PUBLIC_COLUMNS)
    .eq("id", event.socialAccountId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();

  if (accountError) {
    throw new ValidationError(accountError.message);
  }
  if (!account) {
    throw new ValidationError("Social account not found for this inbox event");
  }

  const platform = account.platform as SocialPlatform;
  const kind = resolveInboxReplyKind({
    stored: event.replyKind,
    platform,
    url: event.url,
  });

  if (event.leadId) {
    const lead = await getLead(input.workspaceId, event.leadId);
    assertLeadMutable(lead);
    assertCanContactLead({ do_not_contact: lead.doNotContact });
  }

  const prepared = await prepareAccountAdapter(event.socialAccountId, { userId: context.user.id });
  const capabilities = await prepared.adapter.getCapabilities();
  if (!capabilities.inboxReply) {
    throw new UnsupportedActionError(`${prepared.platform} inbox replies are not enabled yet`);
  }

  await takeAccountAdapterRate(event.socialAccountId, prepared.adapter);
  const sent = await prepared.adapter.replyToInbox({
    workspaceId: input.workspaceId,
    socialAccountId: event.socialAccountId,
    kind,
    body: parsed.body,
    externalEventId: event.externalId,
    target: {
      externalProfileId: event.externalProfileId,
      username: event.username,
    },
  });

  if (event.leadId) {
    await recordLeadInteraction({
      workspaceId: input.workspaceId,
      leadId: event.leadId,
      userId: context.user.id,
      type: "MESSAGE",
      socialProfileId: event.socialProfileId,
      socialAccountId: event.socialAccountId,
      relationshipId: event.relationshipId,
      body: parsed.body,
      metadata: {
        inboxEventId: event.id,
        externalEventId: event.externalId,
        externalMessageId: sent.externalMessageId,
        replyKind: kind,
      },
    });
    await markOutboundInboxReply(event.relationshipId, input.workspaceId);
  }

  await logActivity({
    workspaceId: input.workspaceId,
    userId: context.user.id,
    action: "INBOX_REPLIED",
    platform,
    socialAccountId: event.socialAccountId,
    entityType: "inbox_event",
    entityId: event.id,
    metadata: {
      leadId: event.leadId,
      replyKind: kind,
      externalMessageId: sent.externalMessageId,
    },
  });

  return { externalMessageId: sent.externalMessageId, leadId: event.leadId };
}

async function markOutboundInboxReply(relationshipId: string | null, workspaceId: string): Promise<void> {
  if (!relationshipId) {
    return;
  }

  const supabase = await createClient();
  const { data: relationship, error } = await supabase
    .from("contact_relationships")
    .select("id, status")
    .eq("id", relationshipId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) {
    throw new ValidationError(error.message);
  }
  if (!relationship || relationship.status === "REPLIED" || relationship.status === "BLOCKED") {
    return;
  }

  const { error: updateError } = await supabase
    .from("contact_relationships")
    .update({
      status: "MESSAGE_SENT" satisfies ContactStatus,
      last_interacted_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", relationship.id);
  if (updateError) {
    throw new ValidationError(updateError.message);
  }
}
