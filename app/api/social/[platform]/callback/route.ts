import { NextResponse } from "next/server";
import { completeOAuthConnect } from "@/services/social-accounts/oauth-service";
import { errorMessage } from "@/lib/errors";
import { SOCIAL_PLATFORMS, type SocialPlatform } from "@/types/social";

export async function GET(
  request: Request,
  context: { params: Promise<{ platform: string }> },
) {
  const { platform } = await context.params;
  const url = new URL(request.url);

  if (!(SOCIAL_PLATFORMS as readonly string[]).includes(platform)) {
    return NextResponse.redirect(new URL("/?error=unsupported_platform", url.origin));
  }

  try {
    const result = await completeOAuthConnect({
      platform: platform as SocialPlatform,
      code: url.searchParams.get("code"),
      state: url.searchParams.get("state"),
      deviceId: url.searchParams.get("device_id"),
    });
    return NextResponse.redirect(
      new URL(`/w/${result.workspaceId}/social-accounts?connected=1`, url.origin),
    );
  } catch (error) {
    const message = encodeURIComponent(errorMessage(error, "OAuth connection failed"));
    return NextResponse.redirect(new URL(`/social-accounts/oauth-error?message=${message}`, url.origin));
  }
}
