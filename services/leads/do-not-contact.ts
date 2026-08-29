import { DoNotContactError } from "@/lib/errors";

export type LeadContactPolicy = {
  do_not_contact: boolean;
};

export function canContactLead(lead: LeadContactPolicy): boolean {
  return lead.do_not_contact !== true;
}

export function assertCanContactLead(lead: LeadContactPolicy): void {
  if (!canContactLead(lead)) {
    throw new DoNotContactError();
  }
}
