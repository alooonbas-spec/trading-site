import { createClient } from "@/lib/supabase/server";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { ValidationError } from "@/lib/errors";
import { SOCIAL_ACCOUNT_PUBLIC_COLUMNS } from "@/types/social-account";
import { LEAD_PUBLIC_COLUMNS } from "@/types/crm";
import {
  INBOX_EVENT_PUBLIC_COLUMNS,
  INBOX_MATCH_FILTERS,
  type InboxEvent,
  type InboxEventListItem,
  type InboxMatchFilter,
} from "@/types/inbox";
import type { SocialPlatform } from "@/types/social";
import { toInboxEvent, type InboxEventRow } from "@/services/inbox/mapper";
import { resolveInboxReplyKind } from "@/lib/inbox/reply-kind";

const INBOX_PAGE_SIZE = 200;

export function parseInboxMatchFilter(value: string | undefined): InboxMatchFilter {
  if (value && (INBOX_MATCH_FILTERS as readonly string[]).includes(value)) {
    return value as InboxMatchFilter;
  }
  return "all";
}

export async function listInboxEvents(input: {
  workspaceId: string;
  match?: InboxMatchFilter;
  query?: string;
}): Promise<InboxEventListItem[]> {
  await requireWorkspaceContext(input.workspaceId);
  const supabase = await createClient();
  let request = supabase
    .from("inbox_events")
    .select(INBOX_EVENT_PUBLIC_COLUMNS)
    .eq("workspace_id", input.workspaceId)
    .order("received_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(INBOX_PAGE_SIZE);

  if (input.match === "unmatched") {
    request = request.eq("matched", false);
  } else if (input.match === "matched") {
    request = request.eq("matched", true);
  }

  const query = sanitizeIlike(input.query);
  if (query) {
    request = request.or(`username.ilike.%${query}%,body.ilike.%${query}%,external_profile_id.ilike.%${query}%`);
  }

  const { data, error } = await request;
  if (error) {
    throw new ValidationError(error.message);
  }

  const rows = (data ?? []) as InboxEventRow[];
  return hydrateInboxEvents(input.workspaceId, rows);
}

export async function listInboxEventsForLead(
  workspaceId: string,
  leadId: string,
): Promise<InboxEventListItem[]> {
  await requireWorkspaceContext(workspaceId);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inbox_events")
    .select(INBOX_EVENT_PUBLIC_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("lead_id", leadId)
    .order("received_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(INBOX_PAGE_SIZE);

  if (error) {
    throw new ValidationError(error.message);
  }

  return hydrateInboxEvents(workspaceId, (data ?? []) as InboxEventRow[]);
}

export async function getInboxEvent(workspaceId: string, inboxEventId: string): Promise<InboxEvent> {
  await requireWorkspaceContext(workspaceId);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inbox_events")
    .select(INBOX_EVENT_PUBLIC_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("id", inboxEventId)
    .maybeSingle();

  if (error) {
    throw new ValidationError(error.message);
  }
  if (!data) {
    throw new ValidationError("Inbox event not found");
  }

  return toInboxEvent(data as InboxEventRow);
}

async function hydrateInboxEvents(
  workspaceId: string,
  rows: InboxEventRow[],
): Promise<InboxEventListItem[]> {
  if (rows.length === 0) {
    return [];
  }

  const supabase = await createClient();
  const accountIds = [...new Set(rows.map((row) => row.social_account_id))];
  const leadIds = [...new Set(rows.map((row) => row.lead_id).filter((id): id is string => id !== null))];

  const [{ data: accounts, error: accountError }, { data: leads, error: leadError }] = await Promise.all([
    supabase
      .from("social_accounts")
      .select(SOCIAL_ACCOUNT_PUBLIC_COLUMNS)
      .eq("workspace_id", workspaceId)
      .in("id", accountIds),
    leadIds.length > 0
      ? supabase
          .from("leads")
          .select(LEAD_PUBLIC_COLUMNS)
          .eq("workspace_id", workspaceId)
          .in("id", leadIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (accountError) {
    throw new ValidationError(accountError.message);
  }
  if (leadError) {
    throw new ValidationError(leadError.message);
  }

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
  const leadsById = new Map((leads ?? []).map((lead) => [lead.id, lead.display_name]));

  return rows.map((row) => {
    const account = accountsById.get(row.social_account_id);
    if (!account) {
      throw new ValidationError("Inbox event is missing its social account");
    }
    return {
      ...toInboxEvent(row),
      platform: account.platform,
      accountUsername: account.username,
      accountDisplayName: account.displayName,
      leadDisplayName: row.lead_id ? (leadsById.get(row.lead_id) ?? null) : null,
      resolvedReplyKind: resolveInboxReplyKind({
        stored: row.reply_kind,
        platform: account.platform,
        url: row.url,
      }),
    };
  });
}

function sanitizeIlike(value: string | undefined): string {
  return (value ?? "").replace(/[%_,()\\]/g, " ").trim();
}
