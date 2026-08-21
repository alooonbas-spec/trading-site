import { createClient } from "@/lib/supabase/server";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { assertCanMutateWorkspaceData } from "@/lib/auth/permissions";
import { ValidationError } from "@/lib/errors";
import {
  inboxMessageMatchesProfile,
  inboxUsernameForProfile,
  resolveInboxProfileLink,
  unmatchedInboxEventsForProfile,
} from "@/lib/inbox/match-profile";
import { attachInboxEventSchema } from "@/lib/validation/lead";
import { logActivity } from "@/services/activity/activity-service";
import { getInboxEvent } from "@/services/inbox/query-service";
import { toInboxEvent, type InboxEventRow } from "@/services/inbox/mapper";
import { recordInboxReply } from "@/services/inbox/record-reply";
import { createSocialProfile } from "@/services/leads/profile-service";
import { assertLeadMutable, getLead } from "@/services/leads/lead-service";
import {
  CONTACT_RELATIONSHIP_PUBLIC_COLUMNS,
  SOCIAL_PROFILE_PUBLIC_COLUMNS,
  type SocialProfile,
} from "@/types/crm";
import { INBOX_EVENT_PUBLIC_COLUMNS } from "@/types/inbox";
import { SOCIAL_ACCOUNT_PUBLIC_COLUMNS } from "@/types/social-account";
import type { SocialPlatform } from "@/types/social";
import { toSocialProfile } from "@/services/leads/mapper";

export async function attachInboxEventToLead(input: {
  workspaceId: string;
  inboxEventId: string;
  leadId: string;
}): Promise<{ attached: number; profileCreated: boolean }> {
  const context = await requireWorkspaceContext(input.workspaceId);
  assertCanMutateWorkspaceData(context.role);
  const parsed = attachInboxEventSchema.parse({
    inboxEventId: input.inboxEventId,
    leadId: input.leadId,
  });

  const event = await getInboxEvent(input.workspaceId, parsed.inboxEventId);
  if (event.matched) {
    throw new ValidationError("This inbox event is already attached to a lead");
  }

  const lead = await getLead(input.workspaceId, parsed.leadId);
  assertLeadMutable(lead);

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
  const { data: profileRows, error: profileError } = await supabase
    .from("social_profiles")
    .select(SOCIAL_PROFILE_PUBLIC_COLUMNS)
    .eq("workspace_id", input.workspaceId)
    .eq("platform", platform);

  if (profileError) {
    throw new ValidationError(profileError.message);
  }

  const resolution = resolveInboxProfileLink(
    (profileRows ?? []).map((row) => ({
      leadId: row.lead_id,
      externalProfileId: row.external_profile_id,
      username: row.username,
    })),
    event,
    lead.id,
  );

  if (resolution.kind === "conflict") {
    throw new ValidationError("This social identity is already linked to another lead");
  }

  let profile: SocialProfile;
  let profileCreated = false;
  if (resolution.kind === "reuse") {
    const existing = (profileRows ?? []).find(
      (row) =>
        row.lead_id === lead.id &&
        inboxMessageMatchesProfile(event, {
          externalProfileId: row.external_profile_id,
          username: row.username,
        }),
    );
    if (!existing) {
      throw new ValidationError("Matching social profile was not found");
    }
    profile = toSocialProfile(existing);
    profile = await maybeFillProfileUsername(profile, event.username);
  } else {
    profile = await createSocialProfile({
      workspaceId: input.workspaceId,
      leadId: lead.id,
      platform,
      externalProfileId: event.externalProfileId,
      username: inboxUsernameForProfile(event.username),
      displayName: inboxUsernameForProfile(event.username),
    });
    profileCreated = true;
  }

  const { data: unmatchedRows, error: unmatchedError } = await supabase
    .from("inbox_events")
    .select(INBOX_EVENT_PUBLIC_COLUMNS)
    .eq("workspace_id", input.workspaceId)
    .eq("matched", false);

  if (unmatchedError) {
    throw new ValidationError(unmatchedError.message);
  }

  const accountIds = [...new Set((unmatchedRows ?? []).map((row) => row.social_account_id))];
  if (accountIds.length === 0) {
    throw new ValidationError("No unmatched inbox events were attached");
  }

  const { data: unmatchedAccounts, error: unmatchedAccountError } = await supabase
    .from("social_accounts")
    .select("id, platform")
    .eq("workspace_id", input.workspaceId)
    .in("id", accountIds);

  if (unmatchedAccountError) {
    throw new ValidationError(unmatchedAccountError.message);
  }

  const platformByAccountId = new Map(
    (unmatchedAccounts ?? []).map((row) => [row.id, row.platform as SocialPlatform]),
  );
  const siblings = unmatchedInboxEventsForProfile(
    (unmatchedRows ?? []).flatMap((row) => {
      const eventPlatform = platformByAccountId.get(row.social_account_id);
      if (!eventPlatform) {
        return [];
      }
      const mapped = toInboxEvent(row as InboxEventRow);
      return [
        {
          ...mapped,
          matched: mapped.matched,
          platform: eventPlatform,
        },
      ];
    }),
    platform,
    {
      externalProfileId: profile.externalProfileId,
      username: profile.username,
    },
  );

  const { data: relationships, error: relationshipError } = await supabase
    .from("contact_relationships")
    .select(CONTACT_RELATIONSHIP_PUBLIC_COLUMNS)
    .eq("workspace_id", input.workspaceId)
    .eq("social_profile_id", profile.id);

  if (relationshipError) {
    throw new ValidationError(relationshipError.message);
  }

  let attached = 0;
  for (const sibling of siblings) {
    const relationship =
      (relationships ?? []).find((row) => row.social_account_id === sibling.socialAccountId) ?? null;

    const { error: updateError } = await supabase
      .from("inbox_events")
      .update({
        lead_id: lead.id,
        social_profile_id: profile.id,
        relationship_id: relationship?.id ?? null,
        matched: true,
      })
      .eq("id", sibling.id)
      .eq("workspace_id", input.workspaceId)
      .eq("matched", false);

    if (updateError) {
      throw new ValidationError(updateError.message);
    }

    await recordInboxReply({
      workspaceId: input.workspaceId,
      leadId: lead.id,
      socialProfileId: profile.id,
      socialAccountId: sibling.socialAccountId,
      relationshipId: relationship?.id ?? null,
      body: sibling.body,
      externalId: sibling.externalId,
      url: sibling.url,
      userId: context.user.id,
    });
    attached += 1;
  }

  if (attached === 0) {
    throw new ValidationError("No unmatched inbox events were attached");
  }

  await logActivity({
    workspaceId: input.workspaceId,
    userId: context.user.id,
    action: "INBOX_ATTACHED",
    platform,
    socialAccountId: event.socialAccountId,
    entityType: "inbox_event",
    entityId: event.id,
    metadata: {
      leadId: lead.id,
      socialProfileId: profile.id,
      attached,
      profileCreated,
    },
  });

  return { attached, profileCreated };
}

async function maybeFillProfileUsername(
  profile: SocialProfile,
  username: string | null,
): Promise<SocialProfile> {
  if (profile.username) {
    return profile;
  }
  const nextUsername = inboxUsernameForProfile(username);
  if (!nextUsername) {
    return profile;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("social_profiles")
    .update({ username: nextUsername })
    .eq("id", profile.id)
    .select(SOCIAL_PROFILE_PUBLIC_COLUMNS)
    .single();

  if (error || !data) {
    throw new ValidationError(error?.message ?? "Unable to update social profile username");
  }

  return toSocialProfile(data);
}
