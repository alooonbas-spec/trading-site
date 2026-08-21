import type { SocialPlatform } from "@/types/social";

export const INBOX_EVENT_PUBLIC_COLUMNS =
  "id, workspace_id, social_account_id, external_id, external_profile_id, username, body, url, received_at, lead_id, social_profile_id, relationship_id, matched, created_at" as const;

export const INBOX_MATCH_FILTERS = ["all", "unmatched", "matched"] as const;

export type InboxMatchFilter = (typeof INBOX_MATCH_FILTERS)[number];

export type InboxEvent = {
  id: string;
  workspaceId: string;
  socialAccountId: string;
  externalId: string;
  externalProfileId: string;
  username: string | null;
  body: string;
  url: string | null;
  receivedAt: string | null;
  leadId: string | null;
  socialProfileId: string | null;
  relationshipId: string | null;
  matched: boolean;
  createdAt: string;
};

export type InboxEventListItem = InboxEvent & {
  platform: SocialPlatform;
  accountUsername: string | null;
  accountDisplayName: string | null;
  leadDisplayName: string | null;
};
