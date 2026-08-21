import { encryptSecret, getTokenEncryptionKey } from "@/lib/crypto/token-encryption";
import { AuthenticationError, ValidationError, errorMessage } from "@/lib/errors";
import type { ConnectResult } from "@/social/core/adapter";
import type { SocialAccountPublic } from "@/types/social-account";
import { SOCIAL_ACCOUNT_PUBLIC_COLUMNS } from "@/types/social-account";
import type { SocialPlatform } from "@/types/social";
import type { SocialAccountStatus } from "@/types/status";

export const SOCIAL_ACCOUNT_TOKEN_COLUMNS = [
  "access_token_encrypted",
  "refresh_token_encrypted",
] as const;

type SocialAccountRow = {
  id: string;
  workspace_id: string;
  platform: SocialPlatform;
  external_account_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  status: SocialAccountStatus;
  scopes: string[];
  token_expires_at: string | null;
  last_sync_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  created_at: string;
  updated_at: string;
};

export function toPublicSocialAccount(row: SocialAccountRow): SocialAccountPublic {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    platform: row.platform,
    externalAccountId: row.external_account_id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    status: row.status,
    scopes: row.scopes,
    tokenExpiresAt: row.token_expires_at,
    lastSyncAt: row.last_sync_at,
    lastError: row.last_error,
    lastErrorAt: row.last_error_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function encryptConnectResult(result: ConnectResult) {
  try {
    const key = getTokenEncryptionKey();
    return {
      access_token_encrypted: encryptSecret(result.accessToken, key),
      refresh_token_encrypted: result.refreshToken ? encryptSecret(result.refreshToken, key) : null,
      token_expires_at: result.tokenExpiresAt,
    };
  } catch (error) {
    throw new ValidationError(errorMessage(error, "TOKEN_ENCRYPTION_KEY is not configured"));
  }
}

export function assertNoTokenLeak(payload: Record<string, unknown>): void {
  for (const column of SOCIAL_ACCOUNT_TOKEN_COLUMNS) {
    if (column in payload) {
      throw new AuthenticationError("Encrypted tokens must not be sent to the client");
    }
  }
}

export { SOCIAL_ACCOUNT_PUBLIC_COLUMNS };
