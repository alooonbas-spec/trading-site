import type { ContactStatus, LeadStatus } from "@/types/status";
import type { SocialPlatform } from "@/types/social";

export const INTERACTION_TYPES = [
  "NOTE",
  "STATUS_CHANGE",
  "PROFILE_LINKED",
  "PROFILE_COLLECTED",
  "RELATIONSHIP_CREATED",
  "RELATIONSHIP_UPDATED",
  "MERGE",
  "REPLY",
  "MESSAGE",
] as const;

export type InteractionType = (typeof INTERACTION_TYPES)[number];

export type Lead = {
  id: string;
  workspaceId: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  status: LeadStatus;
  doNotContact: boolean;
  mergedIntoId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  profileCount: number;
};

export type SocialProfile = {
  id: string;
  workspaceId: string;
  leadId: string;
  platform: SocialPlatform;
  externalProfileId: string;
  username: string | null;
  displayName: string | null;
  profileUrl: string | null;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ContactRelationship = {
  id: string;
  workspaceId: string;
  leadId: string;
  socialProfileId: string;
  socialAccountId: string;
  status: ContactStatus;
  lastInteractedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LeadInteraction = {
  id: string;
  workspaceId: string;
  leadId: string;
  socialProfileId: string | null;
  socialAccountId: string | null;
  relationshipId: string | null;
  userId: string | null;
  type: InteractionType;
  body: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export const LEAD_PUBLIC_COLUMNS =
  "id, workspace_id, display_name, email, phone, notes, status, do_not_contact, merged_into_id, created_by, created_at, updated_at" as const;

export const SOCIAL_PROFILE_PUBLIC_COLUMNS =
  "id, workspace_id, lead_id, platform, external_profile_id, username, display_name, profile_url, avatar_url, created_at, updated_at" as const;

export const CONTACT_RELATIONSHIP_PUBLIC_COLUMNS =
  "id, workspace_id, lead_id, social_profile_id, social_account_id, status, last_interacted_at, last_error, created_at, updated_at" as const;

export const LEAD_INTERACTION_PUBLIC_COLUMNS =
  "id, workspace_id, lead_id, social_profile_id, social_account_id, relationship_id, user_id, type, body, metadata, created_at" as const;
