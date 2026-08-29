import { headers } from "next/headers";
import { ValidationError } from "@/lib/errors";

export async function getAppOrigin(): Promise<string> {
  const configured = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (configured) {
    return configured.replace(/\/$/, "");
  }

  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  const proto = headerStore.get("x-forwarded-proto") ?? "http";
  if (!host) {
    throw new ValidationError("Set APP_URL so OAuth redirect URIs can be built");
  }

  return `${proto}://${host}`;
}

export function oauthCallbackPath(platform: string): string {
  return `/api/social/${platform}/callback`;
}
