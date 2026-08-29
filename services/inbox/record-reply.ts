import { createClient } from "@/lib/supabase/server";
import { ValidationError } from "@/lib/errors";
import { recordLeadInteraction } from "@/services/leads/interaction-service";
import type { ContactStatus } from "@/types/status";

export async function recordInboxReply(input: {
  workspaceId: string;
  leadId: string;
  socialProfileId: string;
  socialAccountId: string;
  relationshipId: string | null;
  body: string;
  externalId: string;
  url: string | null;
  userId?: string | null;
}): Promise<boolean> {
  await recordLeadInteraction({
    workspaceId: input.workspaceId,
    leadId: input.leadId,
    userId: input.userId ?? null,
    type: "REPLY",
    socialProfileId: input.socialProfileId,
    socialAccountId: input.socialAccountId,
    relationshipId: input.relationshipId,
    body: input.body,
    metadata: { externalId: input.externalId, url: input.url },
  });

  if (!input.relationshipId) {
    return false;
  }

  const supabase = await createClient();
  const { data: relationship, error: relationshipError } = await supabase
    .from("contact_relationships")
    .select("id, status")
    .eq("id", input.relationshipId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();

  if (relationshipError) {
    throw new ValidationError(relationshipError.message);
  }
  if (!relationship || relationship.status === "BLOCKED") {
    return false;
  }

  const { error: statusError } = await supabase
    .from("contact_relationships")
    .update({
      status: "REPLIED" satisfies ContactStatus,
      last_interacted_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", relationship.id);
  if (statusError) {
    throw new ValidationError(statusError.message);
  }

  return true;
}
