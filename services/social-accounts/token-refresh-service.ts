import { createClient } from "@/lib/supabase/server";
import {
  AuthenticationError,
  SocialAccountUnavailableError,
  UnsupportedActionError,
  ValidationError,
} from "@/lib/errors";
import { decryptSecret, encryptSecret, getTokenEncryptionKey } from "@/lib/crypto/token-encryption";
import { deriveTokenStatus, isAccountOperable } from "@/lib/social/account-health";
import { logActivity } from "@/services/activity/activity-service";
import { getSocialAdapter } from "@/social/core/registry";
import type { SocialAdapter, TokenRefreshResult } from "@/social/core/adapter";
import { SOCIAL_ACCOUNT_PUBLIC_COLUMNS } from "@/types/social-account";
import type { SocialPlatform } from "@/types/social";

export async function prepareAccountAdapter(
  accountId: string,
  options?: { userId?: string | null },
): Promise<{
  adapter: SocialAdapter;
  platform: SocialPlatform;
}> {
  const supabase = await createClient();
  const { data: account, error: accountError } = await supabase
    .from("social_accounts")
    .select(SOCIAL_ACCOUNT_PUBLIC_COLUMNS)
    .eq("id", accountId)
    .maybeSingle();
  if (accountError || !account) {
    throw new SocialAccountUnavailableError("Social account not found");
  }

  if (account.status === "DISCONNECTED" || account.status === "REAUTH_REQUIRED" || account.status === "ERROR") {
    throw new SocialAccountUnavailableError();
  }

  const tokenStatus = deriveTokenStatus({
    status: account.status,
    tokenExpiresAt: account.token_expires_at,
  });
  if (tokenStatus === "EXPIRED") {
    await refreshAccountTokens(accountId, options);
  }

  const { data: secrets, error: secretError } = await supabase.rpc("read_social_account_secrets", {
    p_account_id: accountId,
  });
  const secret = secrets?.[0];
  if (secretError || !secret?.access_token_encrypted) {
    throw new SocialAccountUnavailableError("Social account has no access token");
  }
  if (!isAccountOperable(secret.status)) {
    throw new SocialAccountUnavailableError();
  }

  const key = getTokenEncryptionKey();
  return {
    platform: secret.platform,
    adapter: getSocialAdapter(secret.platform, {
      accessToken: decryptSecret(secret.access_token_encrypted, key),
      refreshToken: secret.refresh_token_encrypted ? decryptSecret(secret.refresh_token_encrypted, key) : undefined,
      metadata: secret.metadata,
    }),
  };
}

export async function refreshAccountTokens(
  accountId: string,
  options?: { userId?: string | null },
): Promise<void> {
  const supabase = await createClient();
  const { data: account, error: accountError } = await supabase
    .from("social_accounts")
    .select(SOCIAL_ACCOUNT_PUBLIC_COLUMNS)
    .eq("id", accountId)
    .maybeSingle();
  if (accountError || !account) {
    throw new SocialAccountUnavailableError("Social account not found");
  }

  const { data: secrets, error: secretError } = await supabase.rpc("read_social_account_secrets", {
    p_account_id: accountId,
  });
  const secret = secrets?.[0];
  if (secretError || !secret?.access_token_encrypted) {
    throw new SocialAccountUnavailableError("Social account has no access token");
  }

  const key = getTokenEncryptionKey();
  const adapter = getSocialAdapter(secret.platform, {
    accessToken: decryptSecret(secret.access_token_encrypted, key),
    refreshToken: secret.refresh_token_encrypted ? decryptSecret(secret.refresh_token_encrypted, key) : undefined,
    metadata: secret.metadata,
  });

  let refreshed: TokenRefreshResult;
  try {
    refreshed = await adapter.refreshTokens();
  } catch (caught) {
    if (caught instanceof UnsupportedActionError) {
      throw new SocialAccountUnavailableError("Social account token is expired and cannot be refreshed");
    }
    if (caught instanceof AuthenticationError) {
      await supabase
        .from("social_accounts")
        .update({
          status: "REAUTH_REQUIRED",
          last_error: caught.message,
          last_error_at: new Date().toISOString(),
        })
        .eq("id", accountId);
    }
    throw caught;
  }

  const { error: updateError } = await supabase
    .from("social_accounts")
    .update({
      access_token_encrypted: encryptSecret(refreshed.accessToken, key),
      refresh_token_encrypted: refreshed.refreshToken
        ? encryptSecret(refreshed.refreshToken, key)
        : secret.refresh_token_encrypted,
      token_expires_at: refreshed.tokenExpiresAt,
      status: "CONNECTED",
      last_sync_at: new Date().toISOString(),
      last_error: null,
      last_error_at: null,
      ...(refreshed.scopes ? { scopes: refreshed.scopes } : {}),
    })
    .eq("id", accountId);

  if (updateError) {
    throw new ValidationError(updateError.message);
  }

  if (options?.userId) {
    await logActivity({
      workspaceId: account.workspace_id,
      userId: options.userId,
      action: "SOCIAL_ACCOUNT_TOKEN_REFRESHED",
      platform: account.platform,
      socialAccountId: accountId,
      entityType: "social_account",
      entityId: accountId,
    });
  }
}
