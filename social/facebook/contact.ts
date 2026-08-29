import { z } from "zod";
import { SocialError, ValidationError } from "@/lib/errors";
import { readJson, socialFetch } from "@/social/core/http";
import { FACEBOOK_GRAPH_ORIGIN } from "@/social/facebook/graph";
import type { FacebookPageAuth } from "@/social/facebook/pages";
import { throwIfGraphError } from "@/social/meta/graph-error";

const sendResponseSchema = z.object({
  message_id: z.string().min(1),
});

export function facebookPageMessagesUrl(pageId: string): string {
  return `${FACEBOOK_GRAPH_ORIGIN}/${pageId}/messages`;
}

export function facebookMessengerRecipientId(target: {
  externalProfileId: string;
  username: string | null;
}): string {
  if (/^\d+$/.test(target.externalProfileId)) {
    return target.externalProfileId;
  }
  throw new ValidationError(
    "Facebook Messenger requires a Page-scoped numeric user id from an inbound conversation. Public profile usernames cannot be messaged.",
  );
}

export async function sendFacebookPageMessage(
  page: FacebookPageAuth,
  input: { recipientId: string; text: string },
): Promise<{ externalMessageId: string }> {
  const text = input.text.trim();
  if (!text) {
    throw new ValidationError("Facebook Messenger messages require a body");
  }
  if (!/^\d+$/.test(input.recipientId)) {
    throw new ValidationError("Facebook Messenger requires a Page-scoped numeric user id");
  }

  const url = new URL(facebookPageMessagesUrl(page.id));
  url.searchParams.set("access_token", page.accessToken);
  const response = await socialFetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: input.recipientId },
      messaging_type: "RESPONSE",
      message: { text },
    }),
  });
  const payload = await readJson<unknown>(response);
  throwIfGraphError(payload);
  const parsed = sendResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("Facebook Page messages returned an unexpected payload");
  }
  return { externalMessageId: parsed.data.message_id };
}
