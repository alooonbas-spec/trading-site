import { ValidationError } from "@/lib/errors";

export function isTinyFishConfigured(): boolean {
  return Boolean(process.env.TINYFISH_API_KEY?.trim());
}

export function readTinyFishApiKey(): string {
  const apiKey = process.env.TINYFISH_API_KEY?.trim();
  if (!apiKey) {
    throw new ValidationError("TINYFISH_API_KEY is not configured. Public collection is disabled.");
  }
  return apiKey;
}
