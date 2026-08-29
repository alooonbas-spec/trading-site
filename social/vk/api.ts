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

export function vkErrorCode(payload: unknown): number | null {
  const parsed = vkErrorSchema.safeParse(payload);
  return parsed.success ? parsed.data.error.error_code : null;
}

export function isVkMethodUnavailableError(payload: unknown): boolean {
  const code = vkErrorCode(payload);
  return code === 7 || code === 27;
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

async function vkRequest(method: string, params: Record<string, string>): Promise<unknown> {
  const response = await socialFetch(vkMethodUrl(method), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, v: VK_API_VERSION }),
  });
  return readJson<unknown>(response);
}

function vkResponseBody(method: string, payload: unknown): unknown {
  const parsed = z.object({ response: z.unknown() }).safeParse(payload);
  if (!parsed.success) {
    throw new SocialError(`VK ${method} returned an unexpected payload`);
  }
  return parsed.data.response;
}

export async function vkCall(method: string, params: Record<string, string>): Promise<unknown> {
  const payload = await vkRequest(method, params);
  throwIfVkError(payload);
  return vkResponseBody(method, payload);
}

export async function vkCallIfAvailable(
  method: string,
  params: Record<string, string>,
): Promise<unknown | null> {
  const payload = await vkRequest(method, params);
  if (isVkMethodUnavailableError(payload)) {
    return null;
  }
  throwIfVkError(payload);
  return vkResponseBody(method, payload);
}
