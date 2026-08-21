import { createClient } from "@/lib/supabase/server";
import { ValidationError } from "@/lib/errors";
import {
  LEAD_INTERACTION_PUBLIC_COLUMNS,
  type InteractionType,
  type LeadInteraction,
} from "@/types/crm";
import { toLeadInteraction } from "@/services/leads/mapper";

export async function listLeadInteractions(workspaceId: string, leadId: string): Promise<LeadInteraction[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lead_interactions")
    .select(LEAD_INTERACTION_PUBLIC_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new ValidationError(error.message);
  }

  return (data ?? []).map(toLeadInteraction);
}

export async function recordLeadInteraction(input: {
  workspaceId: string;
  leadId: string;
  userId?: string | null;
  type: InteractionType;
  body?: string | null;
  socialProfileId?: string | null;
  socialAccountId?: string | null;
  relationshipId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<LeadInteraction> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lead_interactions")
    .insert({
      workspace_id: input.workspaceId,
      lead_id: input.leadId,
      user_id: input.userId ?? null,
      type: input.type,
      body: input.body ?? null,
      social_profile_id: input.socialProfileId ?? null,
      social_account_id: input.socialAccountId ?? null,
      relationship_id: input.relationshipId ?? null,
      metadata: input.metadata ?? {},
    })
    .select(LEAD_INTERACTION_PUBLIC_COLUMNS)
    .single();

  if (error || !data) {
    throw new ValidationError(error?.message ?? "Unable to record interaction");
  }

  return toLeadInteraction(data);
}
