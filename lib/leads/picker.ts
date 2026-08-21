import type { Lead } from "@/types/crm";

export const LEAD_PICKER_LIMIT_HINT =
  "Shows the newest 200 matching leads. Search to find others. This picker does not load the whole CRM.";

export const LEAD_PICKER_QUERY_MAX = 120;

export type PickerLead = {
  id: string;
  displayName: string;
  email: string | null;
  doNotContact: boolean;
};

export function toPickerLead(lead: Lead): PickerLead {
  return {
    id: lead.id,
    displayName: lead.displayName,
    email: lead.email,
    doNotContact: lead.doNotContact,
  };
}

export function sanitizePickerQuery(value: string | undefined): string | undefined {
  const query = (value ?? "").trim().slice(0, LEAD_PICKER_QUERY_MAX);
  return query.length > 0 ? query : undefined;
}
