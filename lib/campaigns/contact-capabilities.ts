import type { AdapterContext } from "@/social/core/base-adapter";
import type { CampaignAction } from "@/types/campaign";
import type { SocialCapabilities } from "@/social/core/adapter";
import { getSocialAdapter } from "@/social/core/registry";
import type { SocialPlatform } from "@/types/social";

export function campaignActionSupportedByCapabilities(
  action: CampaignAction,
  capabilities: SocialCapabilities,
): boolean {
  if (action === "MESSAGE") {
    return capabilities.messaging;
  }
  if (action === "INVITE") {
    return capabilities.invites;
  }
  return true;
}

export async function accountSupportsCampaignAction(input: {
  platform: SocialPlatform;
  metadata?: AdapterContext["metadata"];
  action: CampaignAction;
}): Promise<boolean> {
  const capabilities = await getSocialAdapter(input.platform, {
    metadata: input.metadata,
  }).getCapabilities();
  return campaignActionSupportedByCapabilities(input.action, capabilities);
}

export async function platformsSupportingCampaignAction(
  platforms: SocialPlatform[],
  action: CampaignAction,
): Promise<Set<SocialPlatform>> {
  const supported = new Set<SocialPlatform>();
  const unique = [...new Set(platforms)];
  for (const platform of unique) {
    if (await accountSupportsCampaignAction({ platform, action })) {
      supported.add(platform);
    }
  }
  return supported;
}

export function unsupportedCampaignActionMessage(action: CampaignAction): string {
  if (action === "MESSAGE") {
    return "None of the selected connected accounts can send MESSAGE. Connect a Telegram bot, reconnect X with Direct Message scopes (dm.read and dm.write), reconnect Facebook/Instagram with messaging permissions, or connect a VK community token with messages. VK user messaging is not enabled for new apps.";
  }
  if (action === "INVITE") {
    return "None of the selected connected accounts can send INVITE. No current adapter enables invites; Telegram bots cannot CRM-invite.";
  }
  return "None of the selected connected accounts can perform this campaign action.";
}
