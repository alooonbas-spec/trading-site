import { z } from "zod";
import { AuthenticationError, ValidationError } from "@/lib/errors";
import type { ConnectResult } from "@/social/core/adapter";
import { vkCall } from "@/social/vk/api";

export const VK_COMMUNITY_ACCOUNT_KIND = "community";

const groupSchema = z.object({
  id: z.number(),
  name: z.string().optional(),
  screen_name: z.string().optional(),
  photo_200: z.string().optional(),
});

const groupsGetByIdSchema = z.union([
  z.array(groupSchema),
  z.object({
    groups: z.array(groupSchema).optional(),
  }),
]);

export function isVkCommunityAccount(metadata?: Record<string, unknown>): boolean {
  return metadata?.vkAccountKind === VK_COMMUNITY_ACCOUNT_KIND;
}

export function vkCommunityGroupId(metadata?: Record<string, unknown>): string {
  const value = metadata?.vkGroupId;
  if (typeof value === "string" && /^\d+$/.test(value) && value !== "0") {
    return value;
  }
  throw new ValidationError("VK community account is missing vkGroupId");
}

export function vkCommunityMetadata(groupId: string): Record<string, unknown> {
  return {
    vkAccountKind: VK_COMMUNITY_ACCOUNT_KIND,
    vkGroupId: groupId,
    publishOwnerId: `-${groupId}`,
  };
}

export function normalizeVkGroupRef(source: string): string {
  let value = source.trim();
  if (!value) {
    throw new ValidationError("VK community id or screen name is required");
  }
  value = value.replace(/^https?:\/\/(www\.|m\.)?vk\.(com|ru)\//i, "");
  value = value.replace(/^@/, "");
  value = value.split(/[/?#]/)[0] ?? value;
  const prefixed = /^(club|public|event|group)(\d+)$/i.exec(value);
  if (prefixed?.[2]) {
    return prefixed[2];
  }
  if (/^-?\d+$/.test(value) && value !== "0" && value !== "-0") {
    return String(Math.abs(Number(value)));
  }
  if (!/^[A-Za-z0-9._]+$/.test(value)) {
    throw new ValidationError("VK community id or screen name is invalid");
  }
  return value;
}

export async function connectVkCommunity(input: {
  token: string;
  groupRef: string;
}): Promise<ConnectResult> {
  const token = input.token.trim();
  if (!token) {
    throw new ValidationError("VK community token is required");
  }
  if (/\s/.test(token) || token.length < 16) {
    throw new ValidationError("VK community token format is invalid");
  }

  const group = await fetchVkCommunity(token, normalizeVkGroupRef(input.groupRef));
  const groupId = String(group.id);
  return {
    externalAccountId: groupId,
    username: group.screen_name ?? null,
    displayName: group.name ?? group.screen_name ?? groupId,
    avatarUrl: group.photo_200 ?? null,
    scopes: ["community", "messages"],
    accessToken: token,
    refreshToken: null,
    tokenExpiresAt: null,
    metadata: vkCommunityMetadata(groupId),
  };
}

export async function fetchVkCommunity(
  accessToken: string,
  groupRef: string,
): Promise<{ id: number; name?: string; screen_name?: string; photo_200?: string }> {
  const payload = await vkCall("groups.getById", {
    access_token: accessToken,
    group_id: groupRef,
    fields: "photo_200",
  });
  const parsed = groupsGetByIdSchema.safeParse(payload);
  const group = parsed.success
    ? Array.isArray(parsed.data)
      ? parsed.data[0]
      : parsed.data.groups?.[0]
    : undefined;
  if (!group) {
    throw new AuthenticationError("VK community token did not return that group");
  }
  if (/^\d+$/.test(groupRef) && String(group.id) !== groupRef) {
    throw new AuthenticationError("VK community token does not match that group id");
  }
  return group;
}
