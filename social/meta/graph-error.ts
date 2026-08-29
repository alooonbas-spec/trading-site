import { z } from "zod";
import { AuthenticationError, SocialError } from "@/lib/errors";

const graphErrorSchema = z.object({
  error: z.object({
    message: z.string().optional(),
    type: z.string().optional(),
    code: z.number().optional(),
  }),
});

export function throwIfGraphError(payload: unknown): void {
  const parsed = graphErrorSchema.safeParse(payload);
  if (!parsed.success) {
    return;
  }

  const message = parsed.data.error.message ?? "Graph API request failed";
  if (parsed.data.error.code === 190 || parsed.data.error.type === "OAuthException") {
    throw new AuthenticationError(message);
  }

  throw new SocialError(message);
}
