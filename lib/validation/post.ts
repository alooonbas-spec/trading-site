import { z } from "zod";
import { ValidationError } from "@/lib/errors";

export const createPostSchema = z.object({
  body: z.string().trim().min(1, "Post body is required").max(4000, "Post body is too long"),
  media: z.array(z.url("Each media item must be a URL")).max(4, "At most 4 media URLs"),
  accountIds: z.array(z.uuid()).min(1, "Select at least one social account"),
  scheduledAt: z.string().nullable().optional(),
});

export function parseMediaList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function parseScheduledAt(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError("Scheduled time is invalid");
  }

  return parsed.toISOString();
}
