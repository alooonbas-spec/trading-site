import { createClient } from "@/lib/supabase/server";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { assertCanMutateWorkspaceData } from "@/lib/auth/permissions";
import { ValidationError } from "@/lib/errors";
import { preferredContactStatus, profileIdentityKey, survivingDoNotContact } from "@/lib/leads/contact-status";
import { mergeLeadsSchema } from "@/lib/validation/lead";
import { logActivity } from "@/services/activity/activity-service";
import { CONTACT_RELATIONSHIP_PUBLIC_COLUMNS, SOCIAL_PROFILE_PUBLIC_COLUMNS } from "@/types/crm";
import { assertLeadMutable, getLead } from "@/services/leads/lead-service";
import { recordLeadInteraction } from "@/services/leads/interaction-service";
import type { Lead } from "@/types/crm";

export async function mergeLeads(input: {
  workspaceId: string;
  sourceLeadId: string;
  targetLeadId: string;
}): Promise<Lead> {
  const context = await requireWorkspaceContext(input.workspaceId);
  assertCanMutateWorkspaceData(context.role);
  const parsed = mergeLeadsSchema.parse({
    sourceLeadId: input.sourceLeadId,
    targetLeadId: input.targetLeadId,
  });

  if (parsed.sourceLeadId === parsed.targetLeadId) {
    throw new ValidationError("Cannot merge a lead into itself");
  }

  const [source, target] = await Promise.all([
    getLead(input.workspaceId, parsed.sourceLeadId),
    getLead(input.workspaceId, parsed.targetLeadId),
  ]);
  assertLeadMutable(source);
  assertLeadMutable(target);

  const supabase = await createClient();
  const [{ data: sourceProfiles, error: sourceProfileError }, { data: targetProfiles, error: targetProfileError }] =
    await Promise.all([
      supabase
        .from("social_profiles")
        .select(SOCIAL_PROFILE_PUBLIC_COLUMNS)
        .eq("lead_id", source.id),
      supabase
        .from("social_profiles")
        .select(SOCIAL_PROFILE_PUBLIC_COLUMNS)
        .eq("lead_id", target.id),
    ]);

  if (sourceProfileError) {
    throw new ValidationError(sourceProfileError.message);
  }
  if (targetProfileError) {
    throw new ValidationError(targetProfileError.message);
  }

  const targetByIdentity = new Map(
    (targetProfiles ?? []).map((profile) => [
      profileIdentityKey(profile.platform, profile.external_profile_id),
      profile,
    ]),
  );

  for (const profile of sourceProfiles ?? []) {
    const identity = profileIdentityKey(profile.platform, profile.external_profile_id);
    const existing = targetByIdentity.get(identity);
    if (existing) {
      await reassignRelationships(supabase, profile.id, existing.id, target.id);
      const { error: deleteProfileError } = await supabase
        .from("social_profiles")
        .delete()
        .eq("id", profile.id);
      if (deleteProfileError) {
        throw new ValidationError(deleteProfileError.message);
      }
    } else {
      const { error: moveError } = await supabase
        .from("social_profiles")
        .update({ lead_id: target.id })
        .eq("id", profile.id);
      if (moveError) {
        throw new ValidationError(moveError.message);
      }
    }
  }

  const { error: moveRelationshipsError } = await supabase
    .from("contact_relationships")
    .update({ lead_id: target.id })
    .eq("lead_id", source.id);
  if (moveRelationshipsError) {
    throw new ValidationError(moveRelationshipsError.message);
  }

  const { error: moveInteractionsError } = await supabase
    .from("lead_interactions")
    .update({ lead_id: target.id })
    .eq("lead_id", source.id);
  if (moveInteractionsError) {
    throw new ValidationError(moveInteractionsError.message);
  }

  const nextDoNotContact = survivingDoNotContact(source.doNotContact, target.doNotContact);
  const nextNotes = [target.notes, source.notes].filter(Boolean).join("\n\n") || null;
  const { error: updateTargetError } = await supabase
    .from("leads")
    .update({
      do_not_contact: nextDoNotContact,
      notes: nextNotes,
      email: target.email ?? source.email,
      phone: target.phone ?? source.phone,
    })
    .eq("id", target.id);
  if (updateTargetError) {
    throw new ValidationError(updateTargetError.message);
  }

  const { error: archiveError } = await supabase
    .from("leads")
    .update({
      merged_into_id: target.id,
      status: "ARCHIVED",
    })
    .eq("id", source.id);
  if (archiveError) {
    throw new ValidationError(archiveError.message);
  }

  await recordLeadInteraction({
    workspaceId: input.workspaceId,
    leadId: target.id,
    userId: context.user.id,
    type: "MERGE",
    body: `Merged lead ${source.displayName} into ${target.displayName}`,
    metadata: { sourceLeadId: source.id, targetLeadId: target.id },
  });
  await logActivity({
    workspaceId: input.workspaceId,
    userId: context.user.id,
    action: "LEAD_MERGED",
    entityType: "lead",
    entityId: target.id,
    metadata: { sourceLeadId: source.id },
  });

  return getLead(input.workspaceId, target.id);
}

async function reassignRelationships(
  supabase: Awaited<ReturnType<typeof createClient>>,
  fromProfileId: string,
  toProfileId: string,
  targetLeadId: string,
): Promise<void> {
  const { data: sourceRows, error: sourceError } = await supabase
    .from("contact_relationships")
    .select(CONTACT_RELATIONSHIP_PUBLIC_COLUMNS)
    .eq("social_profile_id", fromProfileId);
  if (sourceError) {
    throw new ValidationError(sourceError.message);
  }

  const { data: targetRows, error: targetError } = await supabase
    .from("contact_relationships")
    .select(CONTACT_RELATIONSHIP_PUBLIC_COLUMNS)
    .eq("social_profile_id", toProfileId);
  if (targetError) {
    throw new ValidationError(targetError.message);
  }

  const targetByAccount = new Map((targetRows ?? []).map((row) => [row.social_account_id, row]));

  for (const row of sourceRows ?? []) {
    const existing = targetByAccount.get(row.social_account_id);
    if (existing) {
      const status = preferredContactStatus(existing.status, row.status);
      const { error: updateError } = await supabase
        .from("contact_relationships")
        .update({
          status,
          lead_id: targetLeadId,
          last_error: existing.last_error ?? row.last_error,
        })
        .eq("id", existing.id);
      if (updateError) {
        throw new ValidationError(updateError.message);
      }
      const { error: deleteError } = await supabase
        .from("contact_relationships")
        .delete()
        .eq("id", row.id);
      if (deleteError) {
        throw new ValidationError(deleteError.message);
      }
    } else {
      const { error: moveError } = await supabase
        .from("contact_relationships")
        .update({
          social_profile_id: toProfileId,
          lead_id: targetLeadId,
        })
        .eq("id", row.id);
      if (moveError) {
        throw new ValidationError(moveError.message);
      }
    }
  }

  const { error: interactionMoveError } = await supabase
    .from("lead_interactions")
    .update({ social_profile_id: toProfileId })
    .eq("social_profile_id", fromProfileId);
  if (interactionMoveError) {
    throw new ValidationError(interactionMoveError.message);
  }
}
