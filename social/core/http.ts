import {
  AuthenticationError,
  NetworkError,
  RateLimitError,
  SocialError,
} from "@/lib/errors";

const TELEGRAM_BOT_PATH = /\/bot[^/]+\//;

export function redactSensitiveUrl(url: string): string {
  return url.replace(TELEGRAM_BOT_PATH, "/bot[redacted]/");
}

export async function socialFetch(url: string, init?: RequestInit): Promise<Response> {
  let response: Response;

  try {
    response = await fetch(url, {
      ...init,
      cache: "no-store",
    });
  } catch (error) {
    throw new NetworkError(
      `Network request failed for ${redactSensitiveUrl(url)}${error instanceof Error ? `: ${error.message}` : ""}`,
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new AuthenticationError("Social platform rejected the credentials");
  }

  if (response.status === 429) {
    throw new RateLimitError("Social platform rate limit reached");
  }

  if (!response.ok) {
    throw new SocialError(`Social platform request failed with HTTP ${response.status}`, {
      url: redactSensitiveUrl(url),
      status: response.status,
    });
  }

  return response;
}

export async function readJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new SocialError("Social platform returned invalid JSON");
  }
}
