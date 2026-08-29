import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { assertCanMutateWorkspaceData } from "@/lib/auth/permissions";
import { createNoteSchema } from "@/lib/validation/lead";
import { assertLeadMutable, getLead } from "@/services/leads/lead-service";
import { recordLeadInteraction } from "@/services/leads/interaction-service";
import type { LeadInteraction } from "@/types/crm";

export async function addLeadNote(input: {
  workspaceId: string;
  leadId: string;
  body: string;
}): Promise<LeadInteraction> {
  const context = await requireWorkspaceContext(input.workspaceId);
  assertCanMutateWorkspaceData(context.role);
  const lead = await getLead(input.workspaceId, input.leadId);
  assertLeadMutable(lead);
  const parsed = createNoteSchema.parse({ body: input.body });

  return recordLeadInteraction({
    workspaceId: input.workspaceId,
    leadId: input.leadId,
    userId: context.user.id,
    type: "NOTE",
    body: parsed.body,
  });
}
