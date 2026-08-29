import { z } from "zod";
import { SocialError, ValidationError } from "@/lib/errors";
import { classifyMediaUrl } from "@/lib/media/classify";
import { downloadPublicMedia } from "@/lib/media/download";
import { parsePublicMediaUrl } from "@/lib/media/public-url";
import { readJson, socialFetch } from "@/social/core/http";
import type { PublishResult } from "@/social/core/adapter";
import { throwIfVkError, vkCall } from "@/social/vk/api";

const uploadServerSchema = z.object({
  upload_url: z.string().min(1),
});

const uploadedPhotoSchema = z.object({
  server: z.union([z.string(), z.number()]),
  photo: z.string().min(1),
  hash: z.string().min(1),
});

const savedPhotoSchema = z.array(
  z.object({
    id: z.number(),
    owner_id: z.number(),
    access_key: z.string().optional(),
  }),
);

const wallPostSchema = z.object({
  post_id: z.number(),
});

export type VkPublishPlan =
  | { type: "text"; message: string }
  | { type: "photos"; urls: string[]; message: string }
  | { type: "video"; url: string; message: string };

export type VkWallTarget = {
  ownerId: string | null;
  groupId: string | null;
  fromGroup: boolean;
};

export function vkWallTarget(metadata?: Record<string, unknown>): VkWallTarget {
  const value = metadata?.publishOwnerId;
  if (typeof value !== "string" || !value.trim()) {
    return { ownerId: null, groupId: null, fromGroup: false };
  }

  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed) || trimmed === "0" || trimmed === "-0") {
    throw new ValidationError("VK publish owner id must be a numeric user or community id");
  }
  if (trimmed.startsWith("-")) {
    return { ownerId: trimmed, groupId: trimmed.slice(1), fromGroup: true };
  }
  return { ownerId: trimmed, groupId: null, fromGroup: false };
}

export function planVkPublish(input: { body: string; media: string[] }): VkPublishPlan {
  const message = input.body.trim();
  if (input.media.length === 0) {
    if (!message) {
      throw new ValidationError("VK wall posts require text or media");
    }
    return { type: "text", message };
  }
  if (input.media.length > 10) {
    throw new ValidationError("VK wall posts support at most 10 photos");
  }

  const items = input.media.map((source) => {
    parsePublicMediaUrl(source);
    return classifyMediaUrl(source);
  });
  if (items.some((item) => item.kind === "document")) {
    throw new ValidationError("VK publishing does not support document URLs");
  }
  const kinds = new Set(items.map((item) => (item.kind === "gif" ? "photo" : item.kind)));
  if (kinds.size > 1) {
    throw new ValidationError("VK cannot mix photos and videos in one post");
  }
  if (kinds.has("video")) {
    const item = items[0];
    if (items.length !== 1 || !item) {
      throw new ValidationError("VK video posts support one mp4 or mov URL");
    }
    if (item.mimeType !== "video/mp4" && item.mimeType !== "video/quicktime") {
      throw new ValidationError("VK videos must be mp4 or mov URLs");
    }
    return { type: "video", url: item.url, message };
  }
  if (items.some((item) => item.kind !== "photo" && item.kind !== "gif")) {
    throw new ValidationError("VK publishing supports jpeg, png, webp, gif, mp4, or mov URLs");
  }
  return { type: "photos", urls: items.map((item) => item.url), message };
}

function photoAttachment(photo: { id: number; owner_id: number; access_key?: string }): string {
  const base = `photo${photo.owner_id}_${photo.id}`;
  return photo.access_key ? `${base}_${photo.access_key}` : base;
}

function videoAttachment(video: { video_id: number; owner_id: number; access_key?: string }): string {
  const base = `video${video.owner_id}_${video.video_id}`;
  return video.access_key ? `${base}_${video.access_key}` : base;
}

const videoSaveSchema = z.object({
  upload_url: z.string().min(1),
  video_id: z.coerce.number(),
  owner_id: z.coerce.number(),
  access_key: z.string().optional(),
});

async function uploadWallVideo(
  accessToken: string,
  source: string,
  message: string,
  target: VkWallTarget,
): Promise<string> {
  const downloaded = await downloadPublicMedia(source);
  const savedPayload = await vkCall("video.save", {
    access_token: accessToken,
    name: (message || "Video").slice(0, 128),
    description: message.slice(0, 4000),
    wallpost: "0",
    ...(target.groupId ? { group_id: target.groupId } : {}),
  });
  const saved = videoSaveSchema.safeParse(savedPayload);
  if (!saved.success) {
    throw new SocialError("VK video.save returned an unexpected payload");
  }
  parsePublicMediaUrl(saved.data.upload_url);

  const filename = downloaded.mimeType === "video/quicktime" ? "video.mov" : "video.mp4";
  const form = new FormData();
  form.set(
    "video_file",
    new Blob([new Uint8Array(downloaded.bytes)], { type: downloaded.mimeType }),
    filename,
  );
  const uploadedResponse = await socialFetch(saved.data.upload_url, {
    method: "POST",
    body: form,
  });
  const uploadedPayload = await readJson<unknown>(uploadedResponse);
  throwIfVkError(uploadedPayload);

  return videoAttachment(saved.data);
}

async function uploadWallPhoto(
  accessToken: string,
  source: string,
  target: VkWallTarget,
): Promise<string> {
  const downloaded = await downloadPublicMedia(source);
  const uploadServerPayload = await vkCall("photos.getWallUploadServer", {
    access_token: accessToken,
    ...(target.groupId ? { group_id: target.groupId } : {}),
  });
  const uploadServer = uploadServerSchema.safeParse(uploadServerPayload);
  if (!uploadServer.success) {
    throw new SocialError("VK photos.getWallUploadServer returned an unexpected payload");
  }
  parsePublicMediaUrl(uploadServer.data.upload_url);

  const form = new FormData();
  form.set(
    "photo",
    new Blob([new Uint8Array(downloaded.bytes)], { type: downloaded.mimeType }),
    downloaded.kind === "gif" ? "photo.gif" : "photo.jpg",
  );
  const uploadedResponse = await socialFetch(uploadServer.data.upload_url, {
    method: "POST",
    body: form,
  });
  const uploadedPayload = await readJson<unknown>(uploadedResponse);
  throwIfVkError(uploadedPayload);
  const uploaded = uploadedPhotoSchema.safeParse(uploadedPayload);
  if (!uploaded.success) {
    throw new SocialError("VK wall photo upload returned an unexpected payload");
  }

  const savedPayload = await vkCall("photos.saveWallPhoto", {
    access_token: accessToken,
    server: String(uploaded.data.server),
    photo: uploaded.data.photo,
    hash: uploaded.data.hash,
    ...(target.groupId ? { group_id: target.groupId } : {}),
  });
  const saved = savedPhotoSchema.safeParse(savedPayload);
  const photo = saved.success ? saved.data[0] : undefined;
  if (!photo) {
    throw new SocialError("VK photos.saveWallPhoto returned an unexpected payload");
  }
  return photoAttachment(photo);
}

export async function executeVkPublish(
  accessToken: string,
  plan: VkPublishPlan,
  metadata?: Record<string, unknown>,
): Promise<PublishResult> {
  const target = vkWallTarget(metadata);
  const attachments =
    plan.type === "photos"
      ? await Promise.all(plan.urls.map((url) => uploadWallPhoto(accessToken, url, target)))
      : plan.type === "video"
        ? [await uploadWallVideo(accessToken, plan.url, plan.message, target)]
        : [];
  const message = plan.message;

  const payload = await vkCall("wall.post", {
    access_token: accessToken,
    ...(message ? { message } : {}),
    ...(attachments.length > 0 ? { attachments: attachments.join(",") } : {}),
    ...(target.ownerId ? { owner_id: target.ownerId } : {}),
    ...(target.fromGroup ? { from_group: "1" } : {}),
  });
  const parsed = wallPostSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SocialError("VK wall.post returned an unexpected payload");
  }

  const externalPostId = target.ownerId
    ? `${target.ownerId}_${parsed.data.post_id}`
    : String(parsed.data.post_id);
  return {
    externalPostId,
    publishedAt: new Date().toISOString(),
  };
}
