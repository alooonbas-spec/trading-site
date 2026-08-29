import { createClient } from "@/lib/supabase/server";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { assertCanMutateWorkspaceData } from "@/lib/auth/permissions";
import { ValidationError } from "@/lib/errors";
import { assertCanContactLead } from "@/services/leads/do-not-contact";
import { isOutboundContactStatus } from "@/lib/leads/contact-status";
import { logActivity } from "@/services/activity/activity-service";
import { createRelationshipSchema, updateRelationshipSchema } from "@/lib/validation/lead";
import { CONTACT_RELATIONSHIP_PUBLIC_COLUMNS, type ContactRelationship } from "@/types/crm";
import { toContactRelationship } from "@/services/leads/mapper";
import { assertLeadMutable, getLead } from "@/services/leads/lead-service";
import { recordLeadInteraction } from "@/services/leads/interaction-service";
import { SOCIAL_ACCOUNT_PUBLIC_COLUMNS } from "@/types/social-account";
import type { ContactStatus } from "@/types/status";

export async function listContactRelationships(
  workspaceId: string,
  leadId: string,
): Promise<ContactRelationship[]> {
  await requireWorkspaceContext(workspaceId);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contact_relationships")
    .select(CONTACT_RELATIONSHIP_PUBLIC_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new ValidationError(error.message);
  }

  return (data ?? []).map(toContactRelationship);
}

export async function createContactRelationship(input: {
  workspaceId: string;
  leadId: string;
  socialProfileId: string;
  socialAccountId: string;
}): Promise<ContactRelationship> {
  const context = await requireWorkspaceContext(input.workspaceId);
  assertCanMutateWorkspaceData(context.role);
  const lead = await getLead(input.workspaceId, input.leadId);
  assertLeadMutable(lead);
  const parsed = createRelationshipSchema.parse({
    socialProfileId: input.socialProfileId,
    socialAccountId: input.socialAccountId,
  });

  const supabase = await createClient();
  const [{ data: profile }, { data: account }] = await Promise.all([
    supabase
      .from("social_profiles")
      .select("id, lead_id")
      .eq("id", parsed.socialProfileId)
      .eq("workspace_id", input.workspaceId)
      .maybeSingle(),
    supabase
      .from("social_accounts")
      .select(SOCIAL_ACCOUNT_PUBLIC_COLUMNS)
      .eq("id", parsed.socialAccountId)
      .eq("workspace_id", input.workspaceId)
      .maybeSingle(),
  ]);

  if (!profile || profile.lead_id !== input.leadId) {
    throw new ValidationError("Social profile does not belong to this lead");
  }
  if (!account) {
    throw new ValidationError("Social account not found in this workspace");
  }

  const { data, error } = await supabase
    .from("contact_relationships")
    .insert({
      workspace_id: input.workspaceId,
      lead_id: input.leadId,
      social_profile_id: parsed.socialProfileId,
      social_account_id: parsed.socialAccountId,
      status: "NOT_CONTACTED",
    })
    .select(CONTACT_RELATIONSHIP_PUBLIC_COLUMNS)
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      throw new ValidationError("This account is already linked to that profile");
    }
    throw new ValidationError(error?.message ?? "Unable to create contact relationship");
  }

  await recordLeadInteraction({
    workspaceId: input.workspaceId,
    leadId: input.leadId,
    userId: context.user.id,
    type: "RELATIONSHIP_CREATED",
    socialProfileId: parsed.socialProfileId,
    socialAccountId: parsed.socialAccountId,
    relationshipId: data.id,
    body: `Contact relationship created with status ${data.status}`,
  });
  await logActivity({
    workspaceId: input.workspaceId,
    userId: context.user.id,
    action: "LEAD_UPDATED",
    socialAccountId: parsed.socialAccountId,
    entityType: "contact_relationship",
    entityId: data.id,
  });

  return toContactRelationship(data);
}

export async function updateContactRelationship(input: {
  workspaceId: string;
  relationshipId: string;
  status: ContactStatus;
}): Promise<ContactRelationship> {
  const context = await requireWorkspaceContext(input.workspaceId);
  assertCanMutateWorkspaceData(context.role);
  const parsed = updateRelationshipSchema.parse({ status: input.status });

  const supabase = await createClient();
  const { data: current, error: currentError } = await supabase
    .from("contact_relationships")
    .select(CONTACT_RELATIONSHIP_PUBLIC_COLUMNS)
    .eq("id", input.relationshipId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();

  if (currentError || !current) {
    throw new ValidationError(currentError?.message ?? "Contact relationship not found");
  }

  const lead = await getLead(input.workspaceId, current.lead_id);
  assertLeadMutable(lead);
  if (isOutboundContactStatus(parsed.status)) {
    assertCanContactLead({ do_not_contact: lead.doNotContact });
  }

  const { data, error } = await supabase
    .from("contact_relationships")
    .update({
      status: parsed.status,
      last_interacted_at: new Date().toISOString(),
      last_error: parsed.status === "FAILED" ? current.last_error : null,
    })
    .eq("id", input.relationshipId)
    .select(CONTACT_RELATIONSHIP_PUBLIC_COLUMNS)
    .single();

  if (error || !data) {
    throw new ValidationError(error?.message ?? "Unable to update contact relationship");
  }

  await recordLeadInteraction({
    workspaceId: input.workspaceId,
    leadId: current.lead_id,
    userId: context.user.id,
    type: "RELATIONSHIP_UPDATED",
    socialProfileId: current.social_profile_id,
    socialAccountId: current.social_account_id,
    relationshipId: current.id,
    body: `Contact status changed from ${current.status} to ${data.status}`,
    metadata: { from: current.status, to: data.status },
  });
  await logActivity({
    workspaceId: input.workspaceId,
    userId: context.user.id,
    action: parsed.status === "QUEUED" ? "CONTACT_QUEUED" : "LEAD_UPDATED",
    socialAccountId: current.social_account_id,
    entityType: "contact_relationship",
    entityId: current.id,
  });

  return toContactRelationship(data);
}
