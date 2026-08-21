import { z } from "zod";
import { SocialError, ValidationError } from "@/lib/errors";
import { classifyMediaUrl } from "@/lib/media/classify";
import { parsePublicMediaUrl } from "@/lib/media/public-url";
import { readJson, socialFetch } from "@/social/core/http";
import type { PublishResult } from "@/social/core/adapter";
import { FACEBOOK_GRAPH_ORIGIN } from "@/social/facebook/graph";
import type { FacebookPageAuth } from "@/social/facebook/pages";
import { throwIfGraphError } from "@/social/meta/graph-error";

const facebookIdSchema = z.object({
  id: z.union([z.string().min(1), z.number()]),
  post_id: z.string().optional(),
});

export type FacebookPublishPlan =
  | { type: "feed"; message: string }
  | { type: "photo"; url: string; caption: string }
  | { type: "photos"; urls: string[]; message: string }
  | { type: "video"; url: string; description: string };

function requireHttpsMedia(source: string): string {
  const url = parsePublicMediaUrl(source);
  if (url.protocol !== "https:") {
    throw new ValidationError("Facebook media URLs must be https");
  }
  return source;
}

export function planFacebookPublish(input: { body: string; media: string[] }): FacebookPublishPlan {
  const message = input.body.trim();
  if (input.media.length === 0) {
    if (!message) {
      throw new ValidationError("Facebook posts require text or media");
    }
    return { type: "feed", message };
  }

  const items = input.media.map((source) => {
    requireHttpsMedia(source);
    return classifyMediaUrl(source);
  });
  const kinds = new Set(items.map((item) => (item.kind === "gif" ? "photo" : item.kind)));
  if (kinds.has("document")) {
    throw new ValidationError("Facebook Page publishing does not support document URLs");
  }
  if (kinds.size > 1) {
    throw new ValidationError("Facebook cannot mix photos and videos in one post");
  }
  if (kinds.has("video")) {
    const item = items[0];
    if (items.length !== 1 || !item) {
      throw new ValidationError("Facebook video posts support one mp4 or mov URL");
    }
    if (item.mimeType !== "video/mp4" && item.mimeType !== "video/quicktime") {
      throw new ValidationError("Facebook videos must be mp4 or mov URLs");
    }
    return { type: "video", url: item.url, description: message };
  }

  if (items.length === 1 && items[0]) {
    return { type: "photo", url: items[0].url, caption: message };
  }

  return { type: "photos", urls: items.map((item) => item.url), message };
}

async function graphPost(path: string, pageToken: string, params: Record<string, string>): Promise<unknown> {
  const response = await socialFetch(`${FACEBOOK_GRAPH_ORIGIN}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, access_token: pageToken }),
  });
  const payload = await readJson<unknown>(response);
  throwIfGraphError(payload);
  return payload;
}

function publishedId(payload: unknown, fallbackLabel: string): string {
  const parsed = facebookIdSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SocialError(`Facebook ${fallbackLabel} returned an unexpected payload`);
  }
  return parsed.data.post_id ?? String(parsed.data.id);
}

export async function executeFacebookPublish(
  page: FacebookPageAuth,
  plan: FacebookPublishPlan,
): Promise<PublishResult> {
  if (plan.type === "feed") {
    const payload = await graphPost(`${page.id}/feed`, page.accessToken, { message: plan.message });
    return { externalPostId: publishedId(payload, "Page feed"), publishedAt: new Date().toISOString() };
  }

  if (plan.type === "photo") {
    const payload = await graphPost(`${page.id}/photos`, page.accessToken, {
      url: plan.url,
      published: "true",
      ...(plan.caption ? { caption: plan.caption } : {}),
    });
    return { externalPostId: publishedId(payload, "Page photo"), publishedAt: new Date().toISOString() };
  }

  if (plan.type === "video") {
    const payload = await graphPost(`${page.id}/videos`, page.accessToken, {
      file_url: plan.url,
      ...(plan.description ? { description: plan.description } : {}),
    });
    return { externalPostId: publishedId(payload, "Page video"), publishedAt: new Date().toISOString() };
  }

  const mediaFbids: string[] = [];
  for (const url of plan.urls) {
    const unpublished = await graphPost(`${page.id}/photos`, page.accessToken, {
      url,
      published: "false",
    });
    mediaFbids.push(publishedId(unpublished, "unpublished Page photo"));
  }

  const payload = await graphPost(`${page.id}/feed`, page.accessToken, {
    ...(plan.message ? { message: plan.message } : {}),
    attached_media: JSON.stringify(mediaFbids.map((mediaFbid) => ({ media_fbid: mediaFbid }))),
  });
  return { externalPostId: publishedId(payload, "Page album"), publishedAt: new Date().toISOString() };
}
