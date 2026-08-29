import { z } from "zod";
import { SocialError, ValidationError } from "@/lib/errors";
import { readJson, socialFetch } from "@/social/core/http";
import { FACEBOOK_GRAPH_ORIGIN } from "@/social/facebook/graph";
import { throwIfGraphError } from "@/social/meta/graph-error";

const pagesSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().optional(),
        access_token: z.string().optional(),
        tasks: z.array(z.string()).optional(),
      }),
    )
    .optional(),
});

export type FacebookPageAuth = {
  id: string;
  name: string;
  accessToken: string;
};

export function facebookPageIdFromMetadata(metadata?: Record<string, unknown>): string | null {
  const value = metadata?.pageId;
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  return value.trim();
}

export async function listFacebookPages(userAccessToken: string): Promise<FacebookPageAuth[]> {
  const url = new URL(`${FACEBOOK_GRAPH_ORIGIN}/me/accounts`);
  url.searchParams.set("fields", "id,name,access_token,tasks");
  url.searchParams.set("limit", "100");
  url.searchParams.set("access_token", userAccessToken);
  const response = await socialFetch(url.toString());
  const payload = await readJson<unknown>(response);
  throwIfGraphError(payload);
  const parsed = pagesSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("Facebook /me/accounts returned an unexpected payload");
  }

  const pages: FacebookPageAuth[] = [];
  for (const page of parsed.data.data ?? []) {
    if (!page.access_token) {
      continue;
    }
    pages.push({
      id: page.id,
      name: page.name ?? page.id,
      accessToken: page.access_token,
    });
  }
  return pages;
}

export function selectFacebookPage(
  pages: FacebookPageAuth[],
  metadata?: Record<string, unknown>,
): FacebookPageAuth {
  if (pages.length === 0) {
    throw new ValidationError(
      "Facebook publishing requires a Page. Connect a user who manages at least one Page.",
    );
  }

  const pageId = facebookPageIdFromMetadata(metadata);
  if (pageId) {
    const match = pages.find((page) => page.id === pageId);
    if (!match) {
      throw new ValidationError(`Facebook Page ${pageId} was not found on this account`);
    }
    return match;
  }

  if (pages.length === 1 && pages[0]) {
    return pages[0];
  }

  const listed = pages.map((page) => `${page.name} (${page.id})`).join(", ");
  throw new ValidationError(
    `This Facebook user manages multiple Pages. Set the Page ID on the account to one of: ${listed}`,
  );
}

export async function resolveFacebookPage(
  userAccessToken: string,
  metadata?: Record<string, unknown>,
): Promise<FacebookPageAuth> {
  const pages = await listFacebookPages(userAccessToken);
  return selectFacebookPage(pages, metadata);
}

export function facebookConnectMetadata(pages: FacebookPageAuth[]): Record<string, unknown> {
  if (pages.length === 1 && pages[0]) {
    return { pageId: pages[0].id, pageName: pages[0].name };
  }
  if (pages.length > 1) {
    return {
      pageIds: pages.map((page) => ({ id: page.id, name: page.name })),
    };
  }
  return {};
}
