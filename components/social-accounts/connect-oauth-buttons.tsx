"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { startOAuthAction } from "@/app/actions/social-accounts";
import { SOCIAL_PLATFORM_LABELS, type SocialPlatform } from "@/types/social";

const OAUTH_PLATFORMS: SocialPlatform[] = ["vk", "x", "instagram", "facebook"];

export function ConnectOAuthButtons({ workspaceId }: { workspaceId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function connect(platform: SocialPlatform) {
    setError(null);
    startTransition(async () => {
      const result = await startOAuthAction(workspaceId, platform);
      if (result?.error) {
        setError(result.error);
      }
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {OAUTH_PLATFORMS.map((platform) => (
          <Button
            key={platform}
            variant="outline"
            disabled={pending}
            onClick={() => connect(platform)}
          >
            Connect {SOCIAL_PLATFORM_LABELS[platform]}
          </Button>
        ))}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
