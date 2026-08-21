import { z } from "zod";
import { SOCIAL_PLATFORMS } from "@/types/social";
import { parseKeywordList } from "@/lib/monitoring/keywords";

export const createMonitoringRuleSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(80, "Name is too long"),
  keywords: z.array(z.string().trim().min(1)).min(1, "Add at least one keyword"),
  sources: z.array(z.string().trim().min(1)).max(20, "At most 20 sources"),
  platform: z.enum(SOCIAL_PLATFORMS),
  socialAccountId: z.uuid().nullable(),
});

export function parseSourceList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function parseKeywordsField(value: string): string[] {
  return parseKeywordList(value);
}
