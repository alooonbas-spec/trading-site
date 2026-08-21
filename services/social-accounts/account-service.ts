import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/session";
import { assertCanManageWorkspace, canManageAccounts } from "@/lib/auth/permissions";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { AuthenticationError, PermissionError, ValidationError, errorMessage } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { decryptSecret, getTokenEncryptionKey } from "@/lib/crypto/token-encryption";
import { deriveTokenStatus, isAccountOperable } from "@/lib/social/account-health";
import { getSocialAdapter } from "@/social/core/registry";
import type { ConnectInput } from "@/social/core/adapter";
import { logActivity } from "@/services/activity/activity-service";
import {
  encryptConnectResult,
  toPublicSocialAccount,
} from "@/services/social-accounts/mapper";
import { SOCIAL_ACCOUNT_PUBLIC_COLUMNS } from "@/types/social-account";
import type { SocialAccountHealth, SocialAccountPublic } from "@/types/social-account";
import type { SocialPlatform } from "@/types/social";
import { SOCIAL_PLATFORMS } from "@/types/social";

function isSocialPlatform(value: string): value is SocialPlatform {
  return (SOCIAL_PLATFORMS as readonly string[]).includes(value);
}

export async function listSocialAccounts(workspaceId: string): Promise<SocialAccountPublic[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("social_accounts")
    .select(SOCIAL_ACCOUNT_PUBLIC_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map(toPublicSocialAccount);
}

export async function connectSocialAccount(input: {
  workspaceId: string;
  platform: SocialPlatform;
  connectInput?: ConnectInput;
  metadata?: Record<string, unknown>;
}): Promise<SocialAccountPublic> {
  const context = await requireWorkspaceContext(input.workspaceId);
  if (!canManageAccounts(context.role)) {
    throw new PermissionError("Only owners and admins can connect social accounts");
  }

  const adapter = getSocialAdapter(input.platform);
  const connected = await adapter.connect(input.connectInput);
  const encrypted = encryptConnectResult(connected);
  const now = new Date().toISOString();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("social_accounts")
    .upsert(
      {
        workspace_id: input.workspaceId,
        platform: input.platform,
        external_account_id: connected.externalAccountId,
        username: connected.username,
        display_name: connected.displayName,
        avatar_url: connected.avatarUrl,
        status: "CONNECTED",
        access_token_encrypted: encrypted.access_token_encrypted,
        refresh_token_encrypted: encrypted.refresh_token_encrypted,
        token_expires_at: encrypted.token_expires_at,
        scopes: connected.scopes,
        metadata: input.metadata ?? {},
        last_sync_at: now,
        last_error: null,
        last_error_at: null,
      },
      { onConflict: "workspace_id,platform,external_account_id" },
    )
    .select(SOCIAL_ACCOUNT_PUBLIC_COLUMNS)
    .single();

  if (error || !data) {
    throw new ValidationError(error?.message ?? "Unable to store social account");
  }

  const profile = await requireProfile();
  await logActivity({
    workspaceId: input.workspaceId,
    userId: profile.id,
    action: "SOCIAL_ACCOUNT_CONNECTED",
    platform: input.platform,
    socialAccountId: data.id,
    entityType: "social_account",
    entityId: data.id,
  });

  return toPublicSocialAccount(data);
}

export async function refreshSocialAccountHealth(input: {
  workspaceId: string;
  accountId: string;
}): Promise<SocialAccountPublic> {
  const context = await requireWorkspaceContext(input.workspaceId);
  assertCanManageWorkspace(context.role);

  const supabase = await createClient();
  const { data: secrets, error: secretError } = await supabase.rpc("read_social_account_secrets", {
    p_account_id: input.accountId,
  });
  const row = secrets?.[0];

  if (secretError || !row) {
    throw new ValidationError(secretError?.message ?? "Social account not found");
  }

  if (row.status === "DISCONNECTED" || !row.access_token_encrypted) {
    throw new AuthenticationError("Social account is disconnected");
  }

  try {
    const accessToken = decryptSecret(row.access_token_encrypted, getTokenEncryptionKey());
    const adapter = getSocialAdapter(row.platform, { accessToken, metadata: row.metadata });
    const snapshot = await adapter.getAccount();
    const now = new Date().toISOString();
    const { data: updated, error: updateError } = await supabase
      .from("social_accounts")
      .update({
        username: snapshot.username,
        display_name: snapshot.displayName,
        avatar_url: snapshot.avatarUrl,
        status: "CONNECTED",
        last_sync_at: now,
        last_error: null,
        last_error_at: null,
      })
      .eq("id", input.accountId)
      .select(SOCIAL_ACCOUNT_PUBLIC_COLUMNS)
      .single();

    if (updateError || !updated) {
      throw new ValidationError(updateError?.message ?? "Unable to update account health");
    }

    return toPublicSocialAccount(updated);
  } catch (caught) {
    const message = errorMessage(caught, "Health check failed");
    const status = caught instanceof AuthenticationError ? "REAUTH_REQUIRED" : "ERROR";
    const { data: updated } = await supabase
      .from("social_accounts")
      .update({
        status,
        last_error: message,
        last_error_at: new Date().toISOString(),
      })
      .eq("id", input.accountId)
      .select(SOCIAL_ACCOUNT_PUBLIC_COLUMNS)
      .single();

    if (updated) {
      return toPublicSocialAccount(updated);
    }

    throw caught;
  }
}

export async function disconnectSocialAccount(input: {
  workspaceId: string;
  accountId: string;
}): Promise<void> {
  const context = await requireWorkspaceContext(input.workspaceId);
  if (!canManageAccounts(context.role)) {
    throw new PermissionError("Only owners and admins can disconnect social accounts");
  }

  const supabase = await createClient();
  const { data: secrets, error } = await supabase.rpc("read_social_account_secrets", {
    p_account_id: input.accountId,
  });
  const row = secrets?.[0];

  if (error || !row) {
    throw new ValidationError(error?.message ?? "Social account not found");
  }

  if (row.access_token_encrypted) {
    try {
      const accessToken = decryptSecret(row.access_token_encrypted, getTokenEncryptionKey());
      const adapter = getSocialAdapter(row.platform, { accessToken, metadata: row.metadata });
      await adapter.disconnect();
    } catch (caught) {
      if (!(caught instanceof AuthenticationError)) {
        throw caught;
      }
      logger.warn("adapter.disconnect failed with AuthenticationError; clearing local tokens", {
        accountId: input.accountId,
        platform: row.platform,
      });
    }
  }

  const { error: updateError } = await supabase
    .from("social_accounts")
    .update({
      status: "DISCONNECTED",
      access_token_encrypted: null,
      refresh_token_encrypted: null,
      token_expires_at: null,
      last_error: null,
      last_error_at: null,
    })
    .eq("id", input.accountId);

  if (updateError) {
    throw new ValidationError(updateError.message);
  }

  await logActivity({
    workspaceId: input.workspaceId,
    userId: context.user.id,
    action: "SOCIAL_ACCOUNT_DISCONNECTED",
    platform: row.platform,
    socialAccountId: input.accountId,
    entityType: "social_account",
    entityId: input.accountId,
  });
}

export async function listSocialAccountHealth(workspaceId: string): Promise<SocialAccountHealth[]> {
  const accounts = await listSocialAccounts(workspaceId);
  const supabase = await createClient();
  const ids = accounts.map((account) => account.id);
  const activityByAccount = new Map<string, { action: string; created_at: string }>();

  if (ids.length > 0) {
    const { data: activity } = await supabase
      .from("activity_log")
      .select("social_account_id, action, created_at")
      .eq("workspace_id", workspaceId)
      .in("social_account_id", ids)
      .order("created_at", { ascending: false });

    for (const row of activity ?? []) {
      if (!row.social_account_id || activityByAccount.has(row.social_account_id)) {
        continue;
      }
      activityByAccount.set(row.social_account_id, {
        action: row.action,
        created_at: row.created_at,
      });
    }
  }

  return accounts.map((account) => {
    const last = activityByAccount.get(account.id);
    return {
      account,
      tokenStatus: deriveTokenStatus(account),
      lastAction: last?.action ?? null,
      lastActionAt: last?.created_at ?? null,
      queueCount: 0,
      operable: isAccountOperable(account.status) && deriveTokenStatus(account) === "CONNECTED",
    };
  });
}

export async function countSocialAccounts(workspaceId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("social_accounts")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);

  if (error) {
    throw new Error(error.message);
  }

  return count ?? 0;
}

export function parsePlatform(value: string): SocialPlatform {
  if (!isSocialPlatform(value)) {
    throw new ValidationError("Unsupported social platform");
  }
  return value;
}
