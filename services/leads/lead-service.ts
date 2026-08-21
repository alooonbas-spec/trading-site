import { createClient } from "@/lib/supabase/server";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { assertCanManageWorkspace, assertCanMutateWorkspaceData } from "@/lib/auth/permissions";
import { ValidationError } from "@/lib/errors";
import {
  DEFAULT_PAGE_SIZE,
  keysetOrFilter,
  nextKeysetCursor,
  parseKeysetCursor,
  splitKeysetRows,
  type KeysetPage,
} from "@/lib/pagination/keyset";
import { logActivity } from "@/services/activity/activity-service";
import { createLeadSchema, updateLeadSchema } from "@/lib/validation/lead";
import { LEAD_PUBLIC_COLUMNS, type Lead } from "@/types/crm";
import { emptyToNull, toLead } from "@/services/leads/mapper";
import { recordLeadInteraction } from "@/services/leads/interaction-service";
import type { LeadStatus } from "@/types/status";

const LEAD_PAGE_SIZE = DEFAULT_PAGE_SIZE;

type LeadListInput = {
  workspaceId: string;
  query?: string;
  status?: LeadStatus | "all";
  doNotContact?: "all" | "yes" | "no";
  includeMerged?: boolean;
};

export async function listLeads(input: LeadListInput): Promise<Lead[]> {
  await requireWorkspaceContext(input.workspaceId);
  const supabase = await createClient();
  let request = supabase
    .from("leads")
    .select(LEAD_PUBLIC_COLUMNS)
    .eq("workspace_id", input.workspaceId)
    .order("created_at", { ascending: false });
  request = applyLeadListFilters(request, input);

  const { data, error } = await request;
  if (error) {
    throw new ValidationError(error.message);
  }

  return attachLeadProfileCounts(input.workspaceId, data ?? []);
}

export async function listLeadsPage(
  input: LeadListInput & { after?: string },
): Promise<KeysetPage<Lead>> {
  await requireWorkspaceContext(input.workspaceId);
  const supabase = await createClient();
  const cursor = parseKeysetCursor(input.after);
  let request = supabase
    .from("leads")
    .select(LEAD_PUBLIC_COLUMNS)
    .eq("workspace_id", input.workspaceId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(LEAD_PAGE_SIZE + 1);
  if (cursor) {
    request = request.or(keysetOrFilter(cursor));
  }
  request = applyLeadListFilters(request, input);

  const { data, error } = await request;
  if (error) {
    throw new ValidationError(error.message);
  }

  const { page, hasMore } = splitKeysetRows(data ?? [], LEAD_PAGE_SIZE);
  return {
    items: await attachLeadProfileCounts(input.workspaceId, page),
    nextCursor: nextKeysetCursor(page, hasMore),
  };
}

export async function listLeadsByIds(workspaceId: string, leadIds: string[]): Promise<Lead[]> {
  await requireWorkspaceContext(workspaceId);
  const uniqueIds = [...new Set(leadIds)];
  if (uniqueIds.length === 0) {
    return [];
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .select(LEAD_PUBLIC_COLUMNS)
    .eq("workspace_id", workspaceId)
    .in("id", uniqueIds);
  if (error) {
    throw new ValidationError(error.message);
  }

  return attachLeadProfileCounts(workspaceId, data ?? []);
}

export async function findLead(workspaceId: string, leadId: string): Promise<Lead | null> {
  await requireWorkspaceContext(workspaceId);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .select(LEAD_PUBLIC_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("id", leadId)
    .maybeSingle();

  if (error) {
    throw new ValidationError(error.message);
  }
  if (!data) {
    return null;
  }

  const { count } = await supabase
    .from("social_profiles")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", leadId);

  return toLead(data, count ?? 0);
}

export async function getLead(workspaceId: string, leadId: string): Promise<Lead> {
  const lead = await findLead(workspaceId, leadId);
  if (!lead) {
    throw new ValidationError("Lead not found");
  }
  return lead;
}

export async function countLeads(workspaceId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .is("merged_into_id", null);

  if (error) {
    throw new Error(error.message);
  }

  return count ?? 0;
}

export async function countNewLeadsToday(workspaceId: string): Promise<number> {
  const supabase = await createClient();
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const { count, error } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .is("merged_into_id", null)
    .gte("created_at", startOfDay.toISOString());

  if (error) {
    throw new Error(error.message);
  }

  return count ?? 0;
}

export async function createLead(input: {
  workspaceId: string;
  displayName: string;
  email?: string;
  phone?: string;
  notes?: string;
  status?: LeadStatus;
}): Promise<Lead> {
  const context = await requireWorkspaceContext(input.workspaceId);
  assertCanMutateWorkspaceData(context.role);
  const parsed = createLeadSchema.parse({
    displayName: input.displayName,
    email: input.email,
    phone: input.phone,
    notes: input.notes,
    status: input.status,
  });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .insert({
      workspace_id: input.workspaceId,
      display_name: parsed.displayName,
      email: emptyToNull(parsed.email),
      phone: emptyToNull(parsed.phone),
      notes: emptyToNull(parsed.notes),
      status: parsed.status ?? "NEW",
      do_not_contact: parsed.status === "DO_NOT_CONTACT",
      created_by: context.user.id,
    })
    .select(LEAD_PUBLIC_COLUMNS)
    .single();

  if (error || !data) {
    throw new ValidationError(error?.message ?? "Unable to create lead");
  }

  await recordLeadInteraction({
    workspaceId: input.workspaceId,
    leadId: data.id,
    userId: context.user.id,
    type: "STATUS_CHANGE",
    body: `Lead created with status ${data.status}`,
    metadata: { status: data.status },
  });
  await logActivity({
    workspaceId: input.workspaceId,
    userId: context.user.id,
    action: "LEAD_CREATED",
    entityType: "lead",
    entityId: data.id,
  });

  return toLead(data, 0);
}

export async function updateLead(input: {
  workspaceId: string;
  leadId: string;
  displayName?: string;
  email?: string;
  phone?: string;
  notes?: string;
  status?: LeadStatus;
  doNotContact?: boolean;
}): Promise<Lead> {
  const context = await requireWorkspaceContext(input.workspaceId);
  assertCanMutateWorkspaceData(context.role);
  const current = await getLead(input.workspaceId, input.leadId);
  assertLeadMutable(current);

  const parsed = updateLeadSchema.parse({
    displayName: input.displayName,
    email: input.email,
    phone: input.phone,
    notes: input.notes,
    status: input.status,
    doNotContact: input.doNotContact,
  });

  const nextStatus = parsed.status ?? current.status;
  const nextDoNotContact =
    parsed.doNotContact ?? (nextStatus === "DO_NOT_CONTACT" ? true : current.doNotContact);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .update({
      display_name: parsed.displayName ?? current.displayName,
      email: parsed.email === undefined ? current.email : emptyToNull(parsed.email),
      phone: parsed.phone === undefined ? current.phone : emptyToNull(parsed.phone),
      notes: parsed.notes === undefined ? current.notes : emptyToNull(parsed.notes),
      status: nextStatus,
      do_not_contact: nextDoNotContact,
    })
    .eq("id", input.leadId)
    .eq("workspace_id", input.workspaceId)
    .select(LEAD_PUBLIC_COLUMNS)
    .single();

  if (error || !data) {
    throw new ValidationError(error?.message ?? "Unable to update lead");
  }

  if (current.status !== data.status) {
    await recordLeadInteraction({
      workspaceId: input.workspaceId,
      leadId: data.id,
      userId: context.user.id,
      type: "STATUS_CHANGE",
      body: `Lead status changed from ${current.status} to ${data.status}`,
      metadata: { from: current.status, to: data.status },
    });
  }

  await logActivity({
    workspaceId: input.workspaceId,
    userId: context.user.id,
    action: "LEAD_UPDATED",
    entityType: "lead",
    entityId: data.id,
  });

  return toLead(data, current.profileCount);
}

export async function deleteLead(input: { workspaceId: string; leadId: string }): Promise<void> {
  const context = await requireWorkspaceContext(input.workspaceId);
  assertCanManageWorkspace(context.role);
  const current = await getLead(input.workspaceId, input.leadId);
  if (current.mergedIntoId) {
    throw new ValidationError("Merged leads cannot be deleted; they remain for audit");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("leads")
    .delete()
    .eq("id", input.leadId)
    .eq("workspace_id", input.workspaceId);

  if (error) {
    throw new ValidationError(error.message);
  }
}

export function assertLeadMutable(lead: Lead): void {
  if (lead.mergedIntoId) {
    throw new ValidationError("This lead was merged and can no longer be edited");
  }
}

function applyLeadListFilters<
  T extends {
    is: (column: string, value: null) => T;
    eq: (column: string, value: string | boolean) => T;
    or: (filters: string) => T;
  },
>(request: T, input: Omit<LeadListInput, "workspaceId">): T {
  let next = request;
  if (!input.includeMerged) {
    next = next.is("merged_into_id", null);
  }
  if (input.status && input.status !== "all") {
    next = next.eq("status", input.status);
  }
  if (input.doNotContact === "yes") {
    next = next.eq("do_not_contact", true);
  } else if (input.doNotContact === "no") {
    next = next.eq("do_not_contact", false);
  }
  const query = sanitizeIlike(input.query);
  if (query) {
    next = next.or(`display_name.ilike.%${query}%,email.ilike.%${query}%,phone.ilike.%${query}%`);
  }
  return next;
}

async function attachLeadProfileCounts(
  workspaceId: string,
  rows: Array<{ id: string } & Parameters<typeof toLead>[0]>,
): Promise<Lead[]> {
  const supabase = await createClient();
  const ids = rows.map((row) => row.id);
  const counts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: profiles, error: profileError } = await supabase
      .from("social_profiles")
      .select("lead_id")
      .eq("workspace_id", workspaceId)
      .in("lead_id", ids);
    if (profileError) {
      throw new ValidationError(profileError.message);
    }
    for (const profile of profiles ?? []) {
      counts.set(profile.lead_id, (counts.get(profile.lead_id) ?? 0) + 1);
    }
  }
  return rows.map((row) => toLead(row, counts.get(row.id) ?? 0));
}

function sanitizeIlike(value: string | undefined): string {
  return (value ?? "").replace(/[%_,()\\]/g, " ").trim();
}
