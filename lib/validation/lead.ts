import { z } from "zod";
import { CONTACT_STATUSES, LEAD_STATUSES } from "@/types/status";
import { SOCIAL_PLATFORMS } from "@/types/social";

export const leadDisplayNameSchema = z
  .string()
  .trim()
  .min(1, "Lead name is required")
  .max(120, "Lead name is too long");

const optionalEmail = z.union([z.email("Enter a valid email"), z.literal("")]).optional();
const optionalUrl = z.union([z.url("Enter a valid profile URL"), z.literal("")]).optional();

export const createLeadSchema = z.object({
  displayName: leadDisplayNameSchema,
  email: optionalEmail,
  phone: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(4000).optional(),
  status: z.enum(LEAD_STATUSES).optional(),
});

export const updateLeadSchema = z.object({
  displayName: leadDisplayNameSchema.optional(),
  email: z.union([z.email("Enter a valid email"), z.literal("")]).optional(),
  phone: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(4000).optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  doNotContact: z.boolean().optional(),
});

export const createSocialProfileSchema = z.object({
  platform: z.enum(SOCIAL_PLATFORMS),
  externalProfileId: z.string().trim().min(1, "External profile id is required").max(200),
  username: z.string().trim().max(120).optional(),
  displayName: z.string().trim().max(120).optional(),
  profileUrl: optionalUrl,
});

export const createRelationshipSchema = z.object({
  socialProfileId: z.uuid(),
  socialAccountId: z.uuid(),
});

export const updateRelationshipSchema = z.object({
  status: z.enum(CONTACT_STATUSES),
});

export const createNoteSchema = z.object({
  body: z.string().trim().min(1, "Note cannot be empty").max(4000),
});

export const mergeLeadsSchema = z.object({
  sourceLeadId: z.uuid(),
  targetLeadId: z.uuid(),
});

export const collectPublicProfileSchema = z.object({
  platform: z.enum(SOCIAL_PLATFORMS),
  source: z.string().trim().min(1, "Username or public profile URL is required").max(500),
});

export const attachInboxEventSchema = z.object({
  inboxEventId: z.uuid(),
  leadId: z.uuid(),
});

export const replyInboxEventSchema = z.object({
  inboxEventId: z.uuid(),
  body: z.string().trim().min(1, "Reply cannot be empty").max(4000),
});
