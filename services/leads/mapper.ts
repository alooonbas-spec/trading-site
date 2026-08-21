import type { ContactStatus, LeadStatus } from "@/types/status";
import type { SocialPlatform } from "@/types/social";
import type {
  ContactRelationship,
  InteractionType,
  Lead,
  LeadInteraction,
  SocialProfile,
} from "@/types/crm";

type LeadRow = {
  id: string;
  workspace_id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  status: LeadStatus;
  do_not_contact: boolean;
  merged_into_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type SocialProfileRow = {
  id: string;
  workspace_id: string;
  lead_id: string;
  platform: SocialPlatform;
  external_profile_id: string;
  username: string | null;
  display_name: string | null;
  profile_url: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
};

type ContactRelationshipRow = {
  id: string;
  workspace_id: string;
  lead_id: string;
  social_profile_id: string;
  social_account_id: string;
  status: ContactStatus;
  last_interacted_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

type LeadInteractionRow = {
  id: string;
  workspace_id: string;
  lead_id: string;
  social_profile_id: string | null;
  social_account_id: string | null;
  relationship_id: string | null;
  user_id: string | null;
  type: InteractionType;
  body: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export function toLead(row: LeadRow, profileCount = 0): Lead {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    displayName: row.display_name,
    email: row.email,
    phone: row.phone,
    notes: row.notes,
    status: row.status,
    doNotContact: row.do_not_contact,
    mergedIntoId: row.merged_into_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    profileCount,
  };
}

export function toSocialProfile(row: SocialProfileRow): SocialProfile {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    leadId: row.lead_id,
    platform: row.platform,
    externalProfileId: row.external_profile_id,
    username: row.username,
    displayName: row.display_name,
    profileUrl: row.profile_url,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toContactRelationship(row: ContactRelationshipRow): ContactRelationship {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    leadId: row.lead_id,
    socialProfileId: row.social_profile_id,
    socialAccountId: row.social_account_id,
    status: row.status,
    lastInteractedAt: row.last_interacted_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toLeadInteraction(row: LeadInteractionRow): LeadInteraction {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    leadId: row.lead_id,
    socialProfileId: row.social_profile_id,
    socialAccountId: row.social_account_id,
    relationshipId: row.relationship_id,
    userId: row.user_id,
    type: row.type,
    body: row.body,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

export function emptyToNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length === 0 ? null : trimmed;
}
