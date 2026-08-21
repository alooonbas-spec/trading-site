export const SOCIAL_PLATFORMS = [
  "telegram",
  "vk",
  "x",
  "instagram",
  "facebook",
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const SOCIAL_PLATFORM_LABELS: Record<SocialPlatform, string> = {
  telegram: "Telegram",
  vk: "VK",
  x: "X",
  instagram: "Instagram",
  facebook: "Facebook",
};
