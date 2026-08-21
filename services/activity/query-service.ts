import { createClient } from "@/lib/supabase/server";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  ACTIVITY_PUBLIC_COLUMNS,
  type ActivityAction,
  type ActivityEntityType,
  type ActivityLogItem,
} from "@/types/activity";
import { SOCIAL_ACCOUNT_PUBLIC_COLUMNS } from "@/types/social-account";
import { SOCIAL_PLATFORMS, type SocialPlatform } from "@/types/social";

const ACTIVITY_PAGE_SIZE = 200;

export async function listWorkspaceActivity(input: {
  workspaceId: string;
  action?: ActivityAction;
  entityType?: ActivityEntityType;
  socialAccountId?: string;
  platform?: SocialPlatform;
}): Promise<ActivityLogItem[]> {
  await requireWorkspaceContext(input.workspaceId);
  const supabase = await createClient();
  let request = supabase
    .from("activity_log")
    .select(ACTIVITY_PUBLIC_COLUMNS)
    .eq("workspace_id", input.workspaceId)
    .order("created_at", { ascending: false })
    .limit(ACTIVITY_PAGE_SIZE);

  if (input.action) {
    request = request.eq("action", input.action);
  }
  if (input.entityType) {
    request = request.eq("entity_type", input.entityType);
  }
  if (input.socialAccountId) {
    request = request.eq("social_account_id", input.socialAccountId);
  }
  if (input.platform) {
    request = request.eq("platform", input.platform);
  }

  const { data, error } = await request;
  if (error) {
    throw new ValidationError(error.message);
  }

  const rows = data ?? [];
  if (rows.length === 0) {
    return [];
  }

  const userIds = [...new Set(rows.map((row) => row.user_id).filter((id): id is string => id !== null))];
  const accountIds = [
    ...new Set(rows.map((row) => row.social_account_id).filter((id): id is string => id !== null)),
  ];

  const [{ data: profiles, error: profileError }, { data: accounts, error: accountError }] = await Promise.all([
    userIds.length > 0
      ? supabase.from("profiles").select("id, email, display_name").in("id", userIds)
      : Promise.resolve({ data: [], error: null }),
    accountIds.length > 0
      ? supabase
          .from("social_accounts")
          .select(SOCIAL_ACCOUNT_PUBLIC_COLUMNS)
          .eq("workspace_id", input.workspaceId)
          .in("id", accountIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const queryError = profileError ?? accountError;
  if (queryError) {
    throw new ValidationError(queryError.message);
  }

  const profilesById = new Map(
    (profiles ?? []).map((profile) => [
      profile.id,
      { email: profile.email, displayName: profile.display_name },
    ]),
  );
  const accountsById = new Map(
    (accounts ?? []).map((account) => [
      account.id,
      {
        platform: account.platform as SocialPlatform,
        username: account.username,
        displayName: account.display_name,
      },
    ]),
  );

  return rows.map((row) => {
    const account = row.social_account_id ? accountsById.get(row.social_account_id) : undefined;
    const profile = row.user_id ? profilesById.get(row.user_id) : undefined;
    const metadata =
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? logger.redact(row.metadata as Record<string, unknown>)
        : {};
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      userId: row.user_id,
      userEmail: profile?.email ?? null,
      userDisplayName: profile?.displayName ?? null,
      action: row.action,
      platform: parseStoredPlatform(row.platform) ?? account?.platform ?? null,
      socialAccountId: row.social_account_id,
      accountUsername: account?.username ?? null,
      accountDisplayName: account?.displayName ?? null,
      entityType: row.entity_type,
      entityId: row.entity_id,
      metadata,
      createdAt: row.created_at,
    };
  });
}

function parseStoredPlatform(value: string | null): SocialPlatform | null {
  if (value && (SOCIAL_PLATFORMS as readonly string[]).includes(value)) {
    return value as SocialPlatform;
  }
  return null;
}
