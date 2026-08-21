import { z } from "zod";
import { SocialError, ValidationError } from "@/lib/errors";
import { readJson, socialFetch } from "@/social/core/http";
import { classifyMediaUrl, type ClassifiedMedia } from "@/lib/media/classify";
import { downloadPublicMedia, type DownloadedMedia } from "@/lib/media/download";

export const X_MEDIA_INITIALIZE_URL = "https://api.x.com/2/media/upload/initialize";
export const X_APPEND_CHUNK_BYTES = 4 * 1024 * 1024;

const initializeSchema = z.object({
  data: z.object({
    id: z.string().min(1),
  }),
});

const statusSchema = z.object({
  data: z
    .object({
      id: z.string().optional(),
      processing_info: z
        .object({
          state: z.string(),
          check_after_secs: z.number().optional(),
          error: z.object({ message: z.string().optional() }).optional(),
        })
        .optional(),
    })
    .optional(),
});

function xMediaCategory(kind: ClassifiedMedia["kind"]): "tweet_image" | "tweet_gif" | "tweet_video" {
  if (kind === "gif") {
    return "tweet_gif";
  }
  if (kind === "video") {
    return "tweet_video";
  }
  return "tweet_image";
}

function appendUrl(id: string): string {
  return `https://api.x.com/2/media/upload/${id}/append`;
}

function finalizeUrl(id: string): string {
  return `https://api.x.com/2/media/upload/${id}/finalize`;
}

function statusUrl(id: string): string {
  return `https://api.x.com/2/media/upload/${id}`;
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitUntilProcessed(token: string, mediaId: string): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await socialFetch(statusUrl(mediaId), { headers: authHeaders(token) });
    const parsed = statusSchema.safeParse(await readJson<unknown>(response));
    const info = parsed.success ? parsed.data.data?.processing_info : undefined;
    if (!info || info.state === "succeeded") {
      return;
    }
    if (info.state === "failed") {
      throw new SocialError(info.error?.message ?? "X media processing failed");
    }
    await wait(Math.min(Math.max((info.check_after_secs ?? 1) * 1000, 250), 2000));
  }
  throw new SocialError("X media processing timed out");
}

export async function uploadXMedia(token: string, media: DownloadedMedia): Promise<string> {
  const initResponse = await socialFetch(X_MEDIA_INITIALIZE_URL, {
    method: "POST",
    headers: {
      ...authHeaders(token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      media_type: media.mimeType,
      media_category: xMediaCategory(media.kind),
      total_bytes: media.bytes.length,
    }),
  });
  const initialized = initializeSchema.safeParse(await readJson<unknown>(initResponse));
  if (!initialized.success) {
    throw new SocialError("X media initialize returned an unexpected payload");
  }
  const mediaId = initialized.data.data.id;

  const totalChunks = Math.ceil(media.bytes.length / X_APPEND_CHUNK_BYTES);
  for (let index = 0; index < totalChunks; index += 1) {
    const start = index * X_APPEND_CHUNK_BYTES;
    const chunk = media.bytes.subarray(start, start + X_APPEND_CHUNK_BYTES);
    const form = new FormData();
    form.set("segment_index", String(index));
    form.set("media", new Blob([new Uint8Array(chunk)]), `chunk-${index}.bin`);
    await socialFetch(appendUrl(mediaId), {
      method: "POST",
      headers: authHeaders(token),
      body: form,
    });
  }

  const finalizeResponse = await socialFetch(finalizeUrl(mediaId), {
    method: "POST",
    headers: {
      ...authHeaders(token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  const finalized = statusSchema.safeParse(await readJson<unknown>(finalizeResponse));
  const processing = finalized.success ? finalized.data.data?.processing_info : undefined;
  if (processing && processing.state !== "succeeded") {
    await waitUntilProcessed(token, mediaId);
  }
  return mediaId;
}

export async function uploadXMediaFromUrls(token: string, urls: string[]): Promise<string[]> {
  if (urls.length === 0) {
    return [];
  }
  if (urls.length > 4) {
    throw new ValidationError("X posts accept at most 4 media items");
  }

  const downloaded: DownloadedMedia[] = [];
  for (const url of urls) {
    classifyMediaUrl(url);
    downloaded.push(await downloadPublicMedia(url));
  }

  const kinds = new Set(downloaded.map((item) => item.kind));
  if (kinds.has("document")) {
    throw new ValidationError("X does not publish PDF or ZIP attachments");
  }
  if (kinds.size > 1) {
    throw new ValidationError("X cannot mix images, GIFs, and videos in one post");
  }
  if ((kinds.has("video") || kinds.has("gif")) && downloaded.length > 1) {
    throw new ValidationError("X accepts only one GIF or video per post");
  }

  const ids: string[] = [];
  for (const item of downloaded) {
    ids.push(await uploadXMedia(token, item));
  }
  return ids;
}
