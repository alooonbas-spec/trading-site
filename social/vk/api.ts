import { z } from "zod";
import { AuthenticationError, RateLimitError, SocialError } from "@/lib/errors";
import { readJson, socialFetch } from "@/social/core/http";

export const VK_API_VERSION = "5.199";
export const VK_SCOPES = "vkid.personal_info wall photos video offline";

const vkErrorSchema = z.object({
  error: z.object({
    error_code: z.number(),
    error_msg: z.string().optional(),
  }),
});

export function vkMethodUrl(method: string): string {
  return `https://api.vk.com/method/${method}`;
}

export function throwIfVkError(payload: unknown): void {
  const parsed = vkErrorSchema.safeParse(payload);
  if (!parsed.success) {
    return;
  }

  const code = parsed.data.error.error_code;
  const message = parsed.data.error.error_msg ?? "VK API request failed";
  if (code === 5 || code === 15 || code === 17) {
    throw new AuthenticationError(message);
  }
  if (code === 6 || code === 9 || code === 29) {
    throw new RateLimitError(message);
  }
  throw new SocialError(message);
}

export async function vkCall(method: string, params: Record<string, string>): Promise<unknown> {
  const response = await socialFetch(vkMethodUrl(method), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, v: VK_API_VERSION }),
  });
  const payload = await readJson<unknown>(response);
  throwIfVkError(payload);
  const parsed = z.object({ response: z.unknown() }).safeParse(payload);
  if (!parsed.success) {
    throw new SocialError(`VK ${method} returned an unexpected payload`);
  }
  return parsed.data.response;
}
