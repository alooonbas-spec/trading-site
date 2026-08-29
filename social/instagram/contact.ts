import { z } from "zod";
import { SocialError, ValidationError } from "@/lib/errors";
import { readJson, socialFetch } from "@/social/core/http";
import { INSTAGRAM_GRAPH_ORIGIN } from "@/social/instagram/publish";
import { throwIfGraphError } from "@/social/meta/graph-error";

const sendResponseSchema = z.object({
  message_id: z.string().min(1),
});

export function instagramMessagesUrl(userId: string): string {
  return `${INSTAGRAM_GRAPH_ORIGIN}/${userId}/messages`;
}

export function instagramMessengerRecipientId(target: {
  externalProfileId: string;
  username: string | null;
}): string {
  if (/^\d+$/.test(target.externalProfileId)) {
    return target.externalProfileId;
  }
  throw new ValidationError(
    "Instagram Direct Messages require an Instagram-scoped numeric user id from an inbound conversation. Public usernames cannot be messaged.",
  );
}

export async function sendInstagramDirectMessage(
  accessToken: string,
  input: { igUserId: string; recipientId: string; text: string },
): Promise<{ externalMessageId: string }> {
  const text = input.text.trim();
  if (!text) {
    throw new ValidationError("Instagram Direct Messages require a body");
  }
  if (!/^\d+$/.test(input.recipientId)) {
    throw new ValidationError("Instagram Direct Messages require an Instagram-scoped numeric user id");
  }

  const url = new URL(instagramMessagesUrl(input.igUserId));
  url.searchParams.set("access_token", accessToken);
  const response = await socialFetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: input.recipientId },
      message: { text },
    }),
  });
  const payload = await readJson<unknown>(response);
  throwIfGraphError(payload);
  const parsed = sendResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("Instagram messages returned an unexpected payload");
  }
  return { externalMessageId: parsed.data.message_id };
}
