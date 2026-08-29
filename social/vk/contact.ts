import { z } from "zod";
import { SocialError, ValidationError } from "@/lib/errors";
import { vkCall } from "@/social/vk/api";

const usersGetSchema = z.array(
  z.object({
    id: z.number(),
    screen_name: z.string().optional(),
  }),
);

const sendSchema = z.union([
  z.number(),
  z.object({
    message_id: z.number(),
  }),
]);

export function vkCommunityPeerId(target: {
  externalProfileId: string;
  username: string | null;
}): string | null {
  if (/^\d+$/.test(target.externalProfileId) && target.externalProfileId !== "0") {
    return target.externalProfileId;
  }
  return null;
}

export async function resolveVkCommunityPeerId(
  accessToken: string,
  target: { externalProfileId: string; username: string | null },
): Promise<string> {
  const numeric = vkCommunityPeerId(target);
  if (numeric) {
    return numeric;
  }

  const handle = (target.username ?? target.externalProfileId).replace(/^@/, "").trim();
  if (!handle) {
    throw new ValidationError(
      "VK community messages require a numeric user id or screen name on the social profile",
    );
  }

  const payload = await vkCall("users.get", {
    access_token: accessToken,
    user_ids: handle,
  });
  const parsed = usersGetSchema.safeParse(payload);
  const user = parsed.success ? parsed.data[0] : undefined;
  if (!user) {
    throw new SocialError("VK users.get returned an unexpected payload");
  }
  return String(user.id);
}

export async function sendVkCommunityMessage(
  accessToken: string,
  input: { peerId: string; text: string },
): Promise<{ externalMessageId: string }> {
  const text = input.text.trim();
  if (!text) {
    throw new ValidationError("VK community messages require a body");
  }
  if (!/^\d+$/.test(input.peerId) || input.peerId === "0") {
    throw new ValidationError("VK community messages require a numeric user id");
  }

  const payload = await vkCall("messages.send", {
    access_token: accessToken,
    peer_id: input.peerId,
    message: text,
    random_id: String(Math.floor(Math.random() * 2_147_483_647)),
  });
  const parsed = sendSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("VK messages.send returned an unexpected payload");
  }
  const messageId = typeof parsed.data === "number" ? parsed.data : parsed.data.message_id;
  return { externalMessageId: String(messageId) };
}
