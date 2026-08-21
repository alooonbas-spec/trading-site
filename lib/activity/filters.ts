import { z } from "zod";
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES, type ActivityAction, type ActivityEntityType } from "@/types/activity";
import { SOCIAL_PLATFORMS, type SocialPlatform } from "@/types/social";

export const ACTIVITY_ACTION_FILTERS = ["all", ...ACTIVITY_ACTIONS] as const;
export const ACTIVITY_ENTITY_TYPE_FILTERS = ["all", ...ACTIVITY_ENTITY_TYPES] as const;

export type ActivityActionFilter = (typeof ACTIVITY_ACTION_FILTERS)[number];
export type ActivityEntityTypeFilter = (typeof ACTIVITY_ENTITY_TYPE_FILTERS)[number];

const accountIdSchema = z.uuid();

export function parseActivityActionFilter(value: string | undefined): ActivityAction | undefined {
  if (value && (ACTIVITY_ACTIONS as readonly string[]).includes(value)) {
    return value as ActivityAction;
  }
  return undefined;
}

export function parseActivityEntityTypeFilter(value: string | undefined): ActivityEntityType | undefined {
  if (value && (ACTIVITY_ENTITY_TYPES as readonly string[]).includes(value)) {
    return value as ActivityEntityType;
  }
  return undefined;
}

export function parseActivityPlatformFilter(value: string | undefined): SocialPlatform | undefined {
  if (value && (SOCIAL_PLATFORMS as readonly string[]).includes(value)) {
    return value as SocialPlatform;
  }
  return undefined;
}

export function parseActivityAccountIdFilter(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = accountIdSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
