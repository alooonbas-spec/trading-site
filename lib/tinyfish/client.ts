import { z } from "zod";
import {
  AuthenticationError,
  NetworkError,
  RateLimitError,
  SocialError,
  ValidationError,
} from "@/lib/errors";
import { readTinyFishApiKey } from "@/lib/tinyfish/config";
import { SAFE_FETCH_PURPOSE, TINYFISH_ENDPOINTS } from "@/lib/tinyfish/endpoints";
import { assertTinyFishGoalAllowed } from "@/lib/tinyfish/policy";

const fetchPageSchema = z.object({
  url: z.string(),
  final_url: z.string().optional(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  text: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  format: z.string().optional(),
});

const fetchErrorSchema = z.object({
  url: z.string(),
  error: z.string(),
  status: z.number().optional(),
});

const fetchResponseSchema = z.object({
  results: z.array(fetchPageSchema),
  errors: z.array(fetchErrorSchema),
});

const tinyFishErrorEnvelopeSchema = z.object({
  error: z
    .object({
      code: z.string().optional(),
      message: z.string().optional(),
    })
    .optional(),
});

export type TinyFishFetchPage = z.infer<typeof fetchPageSchema>;
export type TinyFishFetchError = z.infer<typeof fetchErrorSchema>;
export type TinyFishFetchResponse = z.infer<typeof fetchResponseSchema>;

function parseRetryAfter(response: Response): number | undefined {
  const raw = response.headers.get("Retry-After");
  if (!raw) {
    return undefined;
  }

  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return undefined;
  }

  return seconds;
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const payload: unknown = await response.json();
    const parsed = tinyFishErrorEnvelopeSchema.safeParse(payload);
    const message = parsed.success ? parsed.data.error?.message?.trim() : "";
    return message && message.length > 0 ? message : fallback;
  } catch {
    return fallback;
  }
}

async function tinyFishRequest(url: string, init: RequestInit): Promise<Response> {
  const apiKey = readTinyFishApiKey();
  let response: Response;

  try {
    response = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
        "X-API-Key": apiKey,
      },
      cache: "no-store",
    });
  } catch (error) {
    throw new NetworkError(
      `TinyFish request failed${error instanceof Error ? `: ${error.message}` : ""}`,
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new AuthenticationError(await readErrorMessage(response, "TinyFish rejected the API key"));
  }

  if (response.status === 429) {
    throw new RateLimitError(await readErrorMessage(response, "TinyFish rate limit exceeded"), {
      code: "RATE_LIMIT_EXCEEDED",
      retryAfter: parseRetryAfter(response),
    });
  }

  if (!response.ok) {
    throw new SocialError(`TinyFish request failed with HTTP ${response.status}`, {
      status: response.status,
    });
  }

  return response;
}

export async function fetchPublicContents(
  urls: string[],
  purpose: string = SAFE_FETCH_PURPOSE,
): Promise<TinyFishFetchResponse> {
  if (urls.length < 1 || urls.length > 10) {
    throw new ValidationError("TinyFish Fetch accepts between 1 and 10 URLs");
  }

  assertTinyFishGoalAllowed(purpose);

  const response = await tinyFishRequest(TINYFISH_ENDPOINTS.fetch, {
    method: "POST",
    body: JSON.stringify({
      urls,
      format: "markdown",
      purpose,
    }),
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new SocialError("TinyFish Fetch returned invalid JSON");
  }

  const parsed = fetchResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("TinyFish Fetch returned an unexpected payload");
  }

  return parsed.data;
}
