import { BotBlockedError, SocialError, ValidationError } from "@/lib/errors";
import { fetchPublicContents } from "@/lib/tinyfish/client";
import type { CollectResult } from "@/social/core/adapter";
import type { SocialPlatform } from "@/types/social";
import type { PublicProfileRef } from "@/social/core/public-profile";

export async function collectResolvedPublicProfile(input: {
  platform: SocialPlatform;
  profile: PublicProfileRef;
}): Promise<CollectResult> {
  const payload = await fetchPublicContents([input.profile.profileUrl]);
  const blocked = payload.errors.find((item) => item.error === "bot_blocked");
  if (blocked) {
    throw new BotBlockedError(
      "The public page blocked automated fetching. Social Hub will not retry with stealth or captcha bypass.",
      { url: blocked.url, platform: input.platform, error: blocked.error },
    );
  }

  const firstError = payload.errors[0];
  if (firstError) {
    if (firstError.error === "page_not_found") {
      throw new ValidationError("Public profile was not found");
    }
    throw new SocialError(`TinyFish could not fetch the public profile (${firstError.error})`, {
      url: firstError.url,
      error: firstError.error,
      status: firstError.status,
    });
  }

  const page = payload.results[0];
  if (!page) {
    throw new ValidationError("TinyFish returned no public profile data");
  }

  const text = typeof page.text === "string" ? page.text : "";
  const displayName = page.title?.trim() || input.profile.username;

  return {
    profiles: [
      {
        externalProfileId: input.profile.externalProfileId,
        username: input.profile.username,
        displayName,
        profileUrl: input.profile.profileUrl,
        avatarUrl: null,
        metadata: {
          title: page.title ?? null,
          description: page.description ?? null,
          finalUrl: page.final_url ?? page.url,
          excerpt: text.slice(0, 500),
          platform: input.platform,
        },
      },
    ],
  };
}
