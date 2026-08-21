import type { ContactStatus } from "@/types/status";

const CONTACT_STATUS_RANK: Record<ContactStatus, number> = {
  NOT_CONTACTED: 0,
  QUEUED: 1,
  FAILED: 2,
  INVITE_PENDING: 3,
  INVITE_SENT: 4,
  MESSAGE_PENDING: 5,
  MESSAGE_SENT: 6,
  REPLIED: 7,
  BLOCKED: 8,
};

export const OUTBOUND_CONTACT_STATUSES: readonly ContactStatus[] = [
  "QUEUED",
  "INVITE_PENDING",
  "INVITE_SENT",
  "MESSAGE_PENDING",
  "MESSAGE_SENT",
];

export function isOutboundContactStatus(status: ContactStatus): boolean {
  return (OUTBOUND_CONTACT_STATUSES as readonly string[]).includes(status);
}

export function preferredContactStatus(left: ContactStatus, right: ContactStatus): ContactStatus {
  if (left === "BLOCKED" || right === "BLOCKED") {
    return "BLOCKED";
  }

  return CONTACT_STATUS_RANK[left] >= CONTACT_STATUS_RANK[right] ? left : right;
}

export function survivingDoNotContact(left: boolean, right: boolean): boolean {
  return left || right;
}

export function profileIdentityKey(platform: string, externalProfileId: string): string {
  return `${platform}:${externalProfileId}`;
}
