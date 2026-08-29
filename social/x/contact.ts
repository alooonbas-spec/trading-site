import { z } from "zod";
import { SocialError, ValidationError } from "@/lib/errors";
import { readJson, socialFetch } from "@/social/core/http";

const sendDmResponseSchema = z.object({
  data: z.object({
    dm_event_id: z.string().min(1),
  }),
});

const byUsernameSchema = z.object({
  data: z.object({
    id: z.string().min(1),
  }),
});

export function xDmConversationUrl(participantId: string): string {
  return `https://api.x.com/2/dm_conversations/with/${participantId}/messages`;
}

export function xUserByUsernameUrl(username: string): string {
  return `https://api.x.com/2/users/by/username/${encodeURIComponent(username)}`;
}

export async function resolveXDmParticipantId(
  accessToken: string,
  target: { externalProfileId: string; username: string | null },
): Promise<string> {
  if (/^\d+$/.test(target.externalProfileId)) {
    return target.externalProfileId;
  }

  const handle = (target.username ?? target.externalProfileId).replace(/^@/, "").trim();
  if (!handle) {
    throw new ValidationError(
      "X Direct Messages require a numeric user id or username on the social profile",
    );
  }

  const response = await socialFetch(xUserByUsernameUrl(handle), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const parsed = byUsernameSchema.safeParse(await readJson<unknown>(response));
  if (!parsed.success) {
    throw new SocialError("X users/by/username returned an unexpected payload");
  }
  return parsed.data.data.id;
}

export async function sendXDirectMessage(
  accessToken: string,
  input: { participantId: string; text: string },
): Promise<{ externalMessageId: string }> {
  const text = input.text.trim();
  if (!text) {
    throw new ValidationError("X Direct Messages require a body");
  }
  if (!/^\d+$/.test(input.participantId)) {
    throw new ValidationError("X Direct Messages require the numeric user id");
  }

  const response = await socialFetch(xDmConversationUrl(input.participantId), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });
  const parsed = sendDmResponseSchema.safeParse(await readJson<unknown>(response));
  if (!parsed.success) {
    throw new SocialError("X create DM returned an unexpected payload");
  }

  return { externalMessageId: parsed.data.data.dm_event_id };
}
