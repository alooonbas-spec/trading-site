import { z } from "zod";
import { AuthenticationError, SocialError, ValidationError } from "@/lib/errors";
import { classifyMediaUrl } from "@/lib/media/classify";
import { parsePublicMediaUrl } from "@/lib/media/public-url";
import { readJson, socialFetch } from "@/social/core/http";
import type { PublishResult } from "@/social/core/adapter";
import { throwIfGraphError } from "@/social/meta/graph-error";

export const INSTAGRAM_GRAPH_ORIGIN = "https://graph.instagram.com";
export const INSTAGRAM_SCOPES =
  "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_comments";

const containerSchema = z.object({
  id: z.string().min(1),
});

const statusSchema = z.object({
  status_code: z.string().optional(),
});

export type InstagramPublishPlan =
  | { type: "image"; url: string; caption: string }
  | { type: "carousel"; urls: string[]; caption: string }
  | { type: "reel"; url: string; caption: string };

export function instagramUserIdFromMetadata(metadata?: Record<string, unknown>): string | null {
  const value = metadata?.instagramUserId;
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  return value.trim();
}

function requireHttpsMedia(source: string): URL {
  const url = parsePublicMediaUrl(source);
  if (url.protocol !== "https:") {
    throw new ValidationError("Instagram media URLs must be https");
  }
  return url;
}

export function planInstagramPublish(input: { body: string; media: string[] }): InstagramPublishPlan {
  const caption = input.body.trim();
  if (input.media.length === 0) {
    throw new ValidationError("Instagram publishing requires an image or mp4 Reel URL");
  }

  const items = input.media.map((source) => {
    requireHttpsMedia(source);
    return classifyMediaUrl(source);
  });
  const kinds = new Set(items.map((item) => item.kind));
  if (kinds.size > 1) {
    throw new ValidationError("Instagram cannot mix images and videos in one post");
  }
  if (kinds.has("gif") || kinds.has("document")) {
    throw new ValidationError("Instagram publishing supports jpeg, png, and mp4 URLs");
  }
  if (kinds.has("video")) {
    const item = items[0];
    if (items.length !== 1 || !item) {
      throw new ValidationError("Instagram Reels support one mp4 URL");
    }
    if (item.mimeType !== "video/mp4") {
      throw new ValidationError("Instagram Reels require an mp4 URL");
    }
    return { type: "reel", url: item.url, caption };
  }

  for (const item of items) {
    if (item.mimeType !== "image/jpeg" && item.mimeType !== "image/png") {
      throw new ValidationError("Instagram images must be jpeg or png URLs");
    }
  }
  if (items.length === 1 && items[0]) {
    return { type: "image", url: items[0].url, caption };
  }
  if (items.length > 10) {
    throw new ValidationError("Instagram carousels support at most 10 images");
  }
  return { type: "carousel", urls: items.map((item) => item.url), caption };
}

async function graphGet(path: string, token: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`${INSTAGRAM_GRAPH_ORIGIN}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("access_token", token);
  const response = await socialFetch(url.toString());
  const payload = await readJson<unknown>(response);
  throwIfGraphError(payload);
  return payload;
}

async function graphPost(path: string, token: string, params: Record<string, string>): Promise<unknown> {
  const response = await socialFetch(`${INSTAGRAM_GRAPH_ORIGIN}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, access_token: token }),
  });
  const payload = await readJson<unknown>(response);
  throwIfGraphError(payload);
  return payload;
}

function containerId(payload: unknown, label: string): string {
  const parsed = containerSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SocialError(`Instagram ${label} returned an unexpected payload`);
  }
  return parsed.data.id;
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitUntilContainerReady(token: string, creationId: string): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const payload = await graphGet(creationId, token, { fields: "status_code" });
    const parsed = statusSchema.safeParse(payload);
    const status = parsed.success ? parsed.data.status_code : undefined;
    if (!status || status === "FINISHED" || status === "PUBLISHED") {
      return;
    }
    if (status === "ERROR" || status === "EXPIRED") {
      throw new SocialError(`Instagram media container ${status.toLowerCase()}`);
    }
    await wait(Math.min(250 * (attempt + 1), 2000));
  }
  throw new SocialError("Instagram media container processing timed out");
}

export async function resolveInstagramUserId(
  accessToken: string,
  metadata?: Record<string, unknown>,
): Promise<string> {
  const fromMetadata = instagramUserIdFromMetadata(metadata);
  if (fromMetadata) {
    return fromMetadata;
  }

  const payload = await graphGet("me", accessToken, { fields: "user_id,id" });
  const parsed = z
    .object({
      id: z.string().optional(),
      user_id: z.union([z.string(), z.number()]).optional(),
    })
    .safeParse(payload);
  const userId = parsed.success ? String(parsed.data.user_id ?? parsed.data.id ?? "") : "";
  if (!userId) {
    throw new AuthenticationError("Instagram /me failed");
  }
  return userId;
}

export async function executeInstagramPublish(
  accessToken: string,
  userId: string,
  plan: InstagramPublishPlan,
): Promise<PublishResult> {
  let creationId: string;
  if (plan.type === "image") {
    creationId = containerId(
      await graphPost(`${userId}/media`, accessToken, {
        image_url: plan.url,
        ...(plan.caption ? { caption: plan.caption } : {}),
      }),
      "image container",
    );
  } else if (plan.type === "reel") {
    creationId = containerId(
      await graphPost(`${userId}/media`, accessToken, {
        media_type: "REELS",
        video_url: plan.url,
        ...(plan.caption ? { caption: plan.caption } : {}),
      }),
      "Reel container",
    );
  } else {
    const children: string[] = [];
    for (const url of plan.urls) {
      children.push(
        containerId(
          await graphPost(`${userId}/media`, accessToken, {
            image_url: url,
            is_carousel_item: "true",
          }),
          "carousel child",
        ),
      );
    }
    creationId = containerId(
      await graphPost(`${userId}/media`, accessToken, {
        media_type: "CAROUSEL",
        children: children.join(","),
        ...(plan.caption ? { caption: plan.caption } : {}),
      }),
      "carousel container",
    );
  }

  await waitUntilContainerReady(accessToken, creationId);
  const published = await graphPost(`${userId}/media_publish`, accessToken, {
    creation_id: creationId,
  });
  return {
    externalPostId: containerId(published, "media_publish"),
    publishedAt: new Date().toISOString(),
  };
}
