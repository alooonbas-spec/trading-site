import { createClient } from "@/lib/supabase/server";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { assertCanMutateWorkspaceData } from "@/lib/auth/permissions";
import { ValidationError } from "@/lib/errors";
import { logActivity } from "@/services/activity/activity-service";
import { createSocialProfileSchema } from "@/lib/validation/lead";
import { SOCIAL_PROFILE_PUBLIC_COLUMNS, type SocialProfile } from "@/types/crm";
import { emptyToNull, toSocialProfile } from "@/services/leads/mapper";
import { assertLeadMutable, getLead } from "@/services/leads/lead-service";
import { recordLeadInteraction } from "@/services/leads/interaction-service";
import type { SocialPlatform } from "@/types/social";

export async function listSocialProfiles(workspaceId: string, leadId: string): Promise<SocialProfile[]> {
  await requireWorkspaceContext(workspaceId);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("social_profiles")
    .select(SOCIAL_PROFILE_PUBLIC_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new ValidationError(error.message);
  }

  return (data ?? []).map(toSocialProfile);
}

export async function createSocialProfile(input: {
  workspaceId: string;
  leadId: string;
  platform: SocialPlatform;
  externalProfileId: string;
  username?: string;
  displayName?: string;
  profileUrl?: string;
}): Promise<SocialProfile> {
  const context = await requireWorkspaceContext(input.workspaceId);
  assertCanMutateWorkspaceData(context.role);
  const lead = await getLead(input.workspaceId, input.leadId);
  assertLeadMutable(lead);

  const parsed = createSocialProfileSchema.parse({
    platform: input.platform,
    externalProfileId: input.externalProfileId,
    username: input.username,
    displayName: input.displayName,
    profileUrl: input.profileUrl,
  });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("social_profiles")
    .insert({
      workspace_id: input.workspaceId,
      lead_id: input.leadId,
      platform: parsed.platform,
      external_profile_id: parsed.externalProfileId,
      username: emptyToNull(parsed.username),
      display_name: emptyToNull(parsed.displayName),
      profile_url: emptyToNull(parsed.profileUrl),
    })
    .select(SOCIAL_PROFILE_PUBLIC_COLUMNS)
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      throw new ValidationError("This social profile is already linked in the workspace");
    }
    throw new ValidationError(error?.message ?? "Unable to link social profile");
  }

  await recordLeadInteraction({
    workspaceId: input.workspaceId,
    leadId: input.leadId,
    userId: context.user.id,
    type: "PROFILE_LINKED",
    socialProfileId: data.id,
    body: `Linked ${parsed.platform} profile ${parsed.externalProfileId}`,
    metadata: { platform: parsed.platform, externalProfileId: parsed.externalProfileId },
  });
  await logActivity({
    workspaceId: input.workspaceId,
    userId: context.user.id,
    action: "SOCIAL_PROFILE_CREATED",
    platform: parsed.platform,
    entityType: "social_profile",
    entityId: data.id,
  });

  return toSocialProfile(data);
}
