import type { SocialPlatform } from "@/types/social";
import type { SocialAccountStatus } from "@/types/status";

export type SocialCapabilities = {
  publishing: boolean;
  scheduling: boolean;
  monitoring: boolean;
  publicCollection: boolean;
  contactActions: boolean;
  messaging: boolean;
};

export type ConnectResult = {
  externalAccountId: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  scopes: string[];
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: string | null;
};

export type SocialAccountSnapshot = {
  platform: SocialPlatform;
  externalAccountId: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  status: SocialAccountStatus;
};

export type CollectInput = {
  workspaceId: string;
  socialAccountId: string;
  source: string;
};

export type CollectResult = {
  profiles: Array<{
    externalProfileId: string;
    username: string | null;
    displayName: string | null;
    profileUrl: string | null;
    avatarUrl: string | null;
    metadata: Record<string, unknown>;
  }>;
};

export type PublishInput = {
  workspaceId: string;
  socialAccountId: string;
  body: string;
  media: string[];
};

export type PublishResult = {
  externalPostId: string;
  publishedAt: string;
};

export type MonitorInput = {
  workspaceId: string;
  socialAccountId: string | null;
  keywords: string[];
  sources: string[];
};

export type MonitorResult = {
  events: Array<{
    externalId: string;
    author: string | null;
    content: string;
    url: string | null;
    matchedKeywords: string[];
  }>;
};

export type ContactActionInput = {
  workspaceId: string;
  socialAccountId: string;
  socialProfileId: string;
  leadId: string;
  action: "INVITE" | "MESSAGE" | "OPEN_PROFILE" | "MANUAL_ACTION_REQUIRED";
  body?: string;
};

export type ContactActionResult = {
  status: "SUCCESS" | "MANUAL_ACTION_REQUIRED" | "OPEN_PROFILE";
  externalMessageId: string | null;
};

export interface SocialAdapter {
  platform: SocialPlatform;
  connect(): Promise<ConnectResult>;
  disconnect(): Promise<void>;
  getAccount(): Promise<SocialAccountSnapshot>;
  getCapabilities(): Promise<SocialCapabilities>;
  collectPublicData(input: CollectInput): Promise<CollectResult>;
  publish(input: PublishInput): Promise<PublishResult>;
  monitor(input: MonitorInput): Promise<MonitorResult>;
  executeContactAction(input: ContactActionInput): Promise<ContactActionResult>;
}
