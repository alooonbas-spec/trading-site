import type { InboxEvent } from "@/types/inbox";

export type InboxEventRow = {
  id: string;
  workspace_id: string;
  social_account_id: string;
  external_id: string;
  external_profile_id: string;
  username: string | null;
  body: string;
  url: string | null;
  received_at: string | null;
  lead_id: string | null;
  social_profile_id: string | null;
  relationship_id: string | null;
  matched: boolean;
  created_at: string;
};

export function toInboxEvent(row: InboxEventRow): InboxEvent {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    socialAccountId: row.social_account_id,
    externalId: row.external_id,
    externalProfileId: row.external_profile_id,
    username: row.username,
    body: row.body,
    url: row.url,
    receivedAt: row.received_at,
    leadId: row.lead_id,
    socialProfileId: row.social_profile_id,
    relationshipId: row.relationship_id,
    matched: row.matched,
    createdAt: row.created_at,
  };
}
