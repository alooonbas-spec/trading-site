import { createClient } from "@/lib/supabase/server";
import { ValidationError } from "@/lib/errors";
import { inboxMessageMatchesProfile } from "@/lib/inbox/match-profile";
import { recordInboxReply } from "@/services/inbox/record-reply";
import type { InboxMessage } from "@/social/core/adapter";
import {
  CONTACT_RELATIONSHIP_PUBLIC_COLUMNS,
  SOCIAL_PROFILE_PUBLIC_COLUMNS,
} from "@/types/crm";
import type { SocialPlatform } from "@/types/social";

export async function ingestInboxMessages(input: {
  workspaceId: string;
  socialAccountId: string;
  platform: SocialPlatform;
  messages: InboxMessage[];
  userId?: string | null;
}): Promise<{ inserted: number; matched: number; replied: number }> {
  if (input.messages.length === 0) {
    return { inserted: 0, matched: 0, replied: 0 };
  }

  const supabase = await createClient();
  const [{ data: profiles, error: profileError }, { data: relationships, error: relationshipError }] =
    await Promise.all([
      supabase
        .from("social_profiles")
        .select(SOCIAL_PROFILE_PUBLIC_COLUMNS)
        .eq("workspace_id", input.workspaceId)
        .eq("platform", input.platform),
      supabase
        .from("contact_relationships")
        .select(CONTACT_RELATIONSHIP_PUBLIC_COLUMNS)
        .eq("workspace_id", input.workspaceId)
        .eq("social_account_id", input.socialAccountId),
    ]);

  if (profileError) {
    throw new ValidationError(profileError.message);
  }
  if (relationshipError) {
    throw new ValidationError(relationshipError.message);
  }

  let inserted = 0;
  let matched = 0;
  let replied = 0;

  for (const message of input.messages) {
    const profile = (profiles ?? []).find((row) =>
      inboxMessageMatchesProfile(message, {
        externalProfileId: row.external_profile_id,
        username: row.username,
      }),
    );
    const relationship = profile
      ? (relationships ?? []).find((row) => row.social_profile_id === profile.id)
      : undefined;

    const { error: insertError } = await supabase.from("inbox_events").insert({
      workspace_id: input.workspaceId,
      social_account_id: input.socialAccountId,
      external_id: message.externalId,
      external_profile_id: message.externalProfileId,
      username: message.username,
      body: message.body,
      url: message.url,
      received_at: message.receivedAt,
      lead_id: profile?.lead_id ?? null,
      social_profile_id: profile?.id ?? null,
      relationship_id: relationship?.id ?? null,
      matched: Boolean(profile),
    });

    if (insertError?.code === "23505") {
      continue;
    }
    if (insertError) {
      throw new ValidationError(insertError.message);
    }
    inserted += 1;

    if (!profile) {
      continue;
    }
    matched += 1;

    const markedReplied = await recordInboxReply({
      workspaceId: input.workspaceId,
      leadId: profile.lead_id,
      userId: input.userId ?? null,
      socialProfileId: profile.id,
      socialAccountId: input.socialAccountId,
      relationshipId: relationship?.id ?? null,
      body: message.body,
      externalId: message.externalId,
      url: message.url,
    });
    if (markedReplied) {
      replied += 1;
    }
  }

  return { inserted, matched, replied };
}
