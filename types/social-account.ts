import type { SocialPlatform } from "@/types/social";
import type { SocialAccountStatus } from "@/types/status";

export type SocialAccountPublic = {
  id: string;
  workspaceId: string;
  platform: SocialPlatform;
  externalAccountId: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  status: SocialAccountStatus;
  scopes: string[];
  tokenExpiresAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SocialAccountHealth = {
  account: SocialAccountPublic;
  tokenStatus: "CONNECTED" | "EXPIRED" | "MISSING" | "REAUTH_REQUIRED" | "ERROR";
  lastAction: string | null;
  lastActionAt: string | null;
  queueCount: number;
  operable: boolean;
};

export type AccountGroup = {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  accountIds: string[];
  createdAt: string;
  updatedAt: string;
};

export const SOCIAL_ACCOUNT_PUBLIC_COLUMNS =
  "id, workspace_id, platform, external_account_id, username, display_name, avatar_url, status, scopes, token_expires_at, last_sync_at, last_error, last_error_at, created_at, updated_at" as const;
