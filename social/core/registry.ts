import type { SocialAdapter } from "@/social/core/adapter";
import type { AdapterContext } from "@/social/core/base-adapter";
import { FacebookAdapter } from "@/social/facebook/adapter";
import { InstagramAdapter } from "@/social/instagram/adapter";
import { TelegramAdapter } from "@/social/telegram/adapter";
import { VkAdapter } from "@/social/vk/adapter";
import { XAdapter } from "@/social/x/adapter";
import { SOCIAL_PLATFORMS, type SocialPlatform } from "@/types/social";

const factories: Record<SocialPlatform, (context?: AdapterContext) => SocialAdapter> = {
  telegram: (context) => new TelegramAdapter(context),
  vk: (context) => new VkAdapter(context),
  x: (context) => new XAdapter(context),
  instagram: (context) => new InstagramAdapter(context),
  facebook: (context) => new FacebookAdapter(context),
};

export function getSocialAdapter(platform: SocialPlatform, context?: AdapterContext): SocialAdapter {
  return factories[platform](context);
}

export function listSocialPlatforms(): SocialPlatform[] {
  return [...SOCIAL_PLATFORMS];
}
