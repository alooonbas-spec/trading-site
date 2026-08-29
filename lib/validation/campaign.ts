import { z } from "zod";
import { CAMPAIGN_ACTIONS } from "@/types/campaign";

export const createCampaignSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(4000).optional(),
  action: z.enum(CAMPAIGN_ACTIONS),
  body: z.string().trim().max(4000).optional(),
  leadIds: z.array(z.uuid()).min(1, "Select at least one lead"),
  accountIds: z.array(z.uuid()).min(1, "Select at least one social account"),
});
