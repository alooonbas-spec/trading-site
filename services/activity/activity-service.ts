import { createClient } from "@/lib/supabase/server";
import type { ActivityAction } from "@/types/activity";
import type { SocialPlatform } from "@/types/social";

export async function logActivity(input: {
  workspaceId: string;
  userId: string;
  action: ActivityAction;
  platform?: SocialPlatform | null;
  socialAccountId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("activity_log").insert({
    workspace_id: input.workspaceId,
    user_id: input.userId,
    action: input.action,
    platform: input.platform ?? null,
    social_account_id: input.socialAccountId ?? null,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    metadata: input.metadata ?? {},
  });

  if (error) {
    throw new Error(error.message);
  }
}
