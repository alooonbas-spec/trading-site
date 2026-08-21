import { UnsupportedActionError } from "@/lib/errors";
import type {
  CollectInput,
  CollectResult,
  ConnectInput,
  ConnectResult,
  ContactActionInput,
  ContactActionResult,
  MonitorInput,
  MonitorResult,
  OAuthBeginInput,
  PublishInput,
  PublishResult,
  SocialAdapter,
  SocialCapabilities,
  SocialAccountSnapshot,
} from "@/social/core/adapter";
import type { SocialPlatform } from "@/types/social";

export type { ConnectInput, OAuthBeginInput };

export type AdapterContext = {
  accessToken?: string;
  refreshToken?: string;
  metadata?: Record<string, unknown>;
};

export const DISABLED_CAPABILITIES: SocialCapabilities = {
  publishing: false,
  scheduling: false,
  monitoring: false,
  publicCollection: false,
  contactActions: false,
  messaging: false,
};

export abstract class BaseSocialAdapter implements SocialAdapter {
  abstract readonly platform: SocialPlatform;
  abstract readonly connectMode: "credential" | "oauth";

  abstract connect(input?: ConnectInput): Promise<ConnectResult>;
  abstract getAccount(): Promise<SocialAccountSnapshot>;
  abstract getCapabilities(): Promise<SocialCapabilities>;

  beginOAuth(_input: OAuthBeginInput): Promise<string> {
    throw new UnsupportedActionError(`${this.platform} does not use OAuth`);
  }

  async disconnect(): Promise<void> {
    return;
  }

  async collectPublicData(_input: CollectInput): Promise<CollectResult> {
    throw new UnsupportedActionError(`${this.platform} public collection is not enabled yet`);
  }

  async publish(_input: PublishInput): Promise<PublishResult> {
    throw new UnsupportedActionError(`${this.platform} publishing is not enabled yet`);
  }

  async monitor(_input: MonitorInput): Promise<MonitorResult> {
    throw new UnsupportedActionError(`${this.platform} monitoring is not enabled yet`);
  }

  async executeContactAction(_input: ContactActionInput): Promise<ContactActionResult> {
    throw new UnsupportedActionError(`${this.platform} contact actions are not enabled yet`);
  }
}
