import { createClient } from "@/lib/supabase/server";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { assertCanMutateWorkspaceData } from "@/lib/auth/permissions";
import { UnsupportedActionError, ValidationError } from "@/lib/errors";
import { collectPublicProfileSchema } from "@/lib/validation/lead";
import { getSocialAdapter } from "@/social/core/registry";
import { logActivity } from "@/services/activity/activity-service";
import { SOCIAL_PROFILE_PUBLIC_COLUMNS, type SocialProfile } from "@/types/crm";
import { emptyToNull, toSocialProfile } from "@/services/leads/mapper";
import { assertLeadMutable, getLead } from "@/services/leads/lead-service";
import { recordLeadInteraction } from "@/services/leads/interaction-service";
import type { SocialPlatform } from "@/types/social";
import type { CollectResult } from "@/social/core/adapter";

export function assertProfileAvailableForLead(
  existingLeadId: string | null | undefined,
  targetLeadId: string,
): void {
  if (existingLeadId && existingLeadId !== targetLeadId) {
    throw new ValidationError("This social profile is already linked to another lead in the workspace");
  }
}

export async function collectLeadPublicProfile(input: {
  workspaceId: string;
  leadId: string;
  platform: SocialPlatform;
  source: string;
}): Promise<{ profiles: SocialProfile[]; created: number; updated: number }> {
  const context = await requireWorkspaceContext(input.workspaceId);
  assertCanMutateWorkspaceData(context.role);
  const lead = await getLead(input.workspaceId, input.leadId);
  assertLeadMutable(lead);

  const parsed = collectPublicProfileSchema.parse({
    platform: input.platform,
    source: input.source,
  });

  const adapter = getSocialAdapter(parsed.platform);
  const capabilities = await adapter.getCapabilities();
  if (!capabilities.publicCollection) {
    throw new UnsupportedActionError(
      "Public collection is not enabled. Set TINYFISH_API_KEY on the server.",
    );
  }

  const collected = await adapter.collectPublicData({
    workspaceId: input.workspaceId,
    source: parsed.source,
  });

  if (collected.profiles.length === 0) {
    throw new ValidationError("TinyFish returned no public profile data");
  }

  const attached: SocialProfile[] = [];
  let created = 0;
  let updated = 0;

  for (const profile of collected.profiles) {
    const result = await attachCollectedProfile({
      workspaceId: input.workspaceId,
      leadId: input.leadId,
      userId: context.user.id,
      platform: parsed.platform,
      profile,
    });
    attached.push(result.profile);
    if (result.created) {
      created += 1;
    } else {
      updated += 1;
    }
  }

  return { profiles: attached, created, updated };
}

async function attachCollectedProfile(input: {
  workspaceId: string;
  leadId: string;
  userId: string;
  platform: SocialPlatform;
  profile: CollectResult["profiles"][number];
}): Promise<{ profile: SocialProfile; created: boolean }> {
  const supabase = await createClient();
  const { data: existing, error: lookupError } = await supabase
    .from("social_profiles")
    .select("id, lead_id")
    .eq("workspace_id", input.workspaceId)
    .eq("platform", input.platform)
    .eq("external_profile_id", input.profile.externalProfileId)
    .maybeSingle();

  if (lookupError) {
    throw new ValidationError(lookupError.message);
  }

  assertProfileAvailableForLead(existing?.lead_id, input.leadId);

  if (existing) {
    const { data, error } = await supabase
      .from("social_profiles")
      .update({
        username: emptyToNull(input.profile.username ?? undefined),
        display_name: emptyToNull(input.profile.displayName ?? undefined),
        profile_url: emptyToNull(input.profile.profileUrl ?? undefined),
        avatar_url: emptyToNull(input.profile.avatarUrl ?? undefined),
        metadata: input.profile.metadata,
      })
      .eq("id", existing.id)
      .eq("workspace_id", input.workspaceId)
      .select(SOCIAL_PROFILE_PUBLIC_COLUMNS)
      .single();

    if (error || !data) {
      throw new ValidationError(error?.message ?? "Unable to update collected social profile");
    }

    await recordLeadInteraction({
      workspaceId: input.workspaceId,
      leadId: input.leadId,
      userId: input.userId,
      type: "PROFILE_COLLECTED",
      socialProfileId: data.id,
      body: `Refreshed ${input.platform} profile ${input.profile.externalProfileId} from public data`,
      metadata: { platform: input.platform, externalProfileId: input.profile.externalProfileId },
    });
    await logActivity({
      workspaceId: input.workspaceId,
      userId: input.userId,
      action: "SOCIAL_PROFILE_COLLECTED",
      platform: input.platform,
      entityType: "social_profile",
      entityId: data.id,
    });

    return { profile: toSocialProfile(data), created: false };
  }

  const { data, error } = await supabase
    .from("social_profiles")
    .insert({
      workspace_id: input.workspaceId,
      lead_id: input.leadId,
      platform: input.platform,
      external_profile_id: input.profile.externalProfileId,
      username: emptyToNull(input.profile.username ?? undefined),
      display_name: emptyToNull(input.profile.displayName ?? undefined),
      profile_url: emptyToNull(input.profile.profileUrl ?? undefined),
      avatar_url: emptyToNull(input.profile.avatarUrl ?? undefined),
      metadata: input.profile.metadata,
    })
    .select(SOCIAL_PROFILE_PUBLIC_COLUMNS)
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      throw new ValidationError("This social profile is already linked in the workspace");
    }
    throw new ValidationError(error?.message ?? "Unable to save collected social profile");
  }

  await recordLeadInteraction({
    workspaceId: input.workspaceId,
    leadId: input.leadId,
    userId: input.userId,
    type: "PROFILE_COLLECTED",
    socialProfileId: data.id,
    body: `Collected ${input.platform} profile ${input.profile.externalProfileId} from public data`,
    metadata: { platform: input.platform, externalProfileId: input.profile.externalProfileId },
  });
  await logActivity({
    workspaceId: input.workspaceId,
    userId: input.userId,
    action: "SOCIAL_PROFILE_COLLECTED",
    platform: input.platform,
    entityType: "social_profile",
    entityId: data.id,
  });

  return { profile: toSocialProfile(data), created: true };
}
