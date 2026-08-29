import { NetworkError, ValidationError } from "@/lib/errors";
import { classifyMediaUrl, type ClassifiedMedia } from "@/lib/media/classify";
import { assertPublicMediaHost } from "@/lib/media/public-url";

const MAX_REDIRECTS = 3;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 15 * 1024 * 1024;

export type DownloadedMedia = ClassifiedMedia & {
  bytes: Buffer;
};

function maxBytesFor(kind: ClassifiedMedia["kind"]): number {
  return kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
}

export async function downloadPublicMedia(source: string): Promise<DownloadedMedia> {
  let current = source;
  for (let attempt = 0; attempt <= MAX_REDIRECTS; attempt += 1) {
    await assertPublicMediaHost(current);
    let response: Response;
    try {
      response = await fetch(current, { redirect: "manual", cache: "no-store" });
    } catch (error) {
      throw new NetworkError(
        `Unable to download media${error instanceof Error ? `: ${error.message}` : ""}`,
      );
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new ValidationError("Media URL redirected without a Location header");
      }
      current = new URL(location, current).toString();
      continue;
    }

    if (!response.ok) {
      throw new ValidationError(`Media download failed with HTTP ${response.status}`);
    }

    const classified = classifyMediaUrl(current, response.headers.get("content-type"));
    const limit = maxBytesFor(classified.kind);
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > limit) {
      throw new ValidationError(`Media is larger than ${limit} bytes`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0) {
      throw new ValidationError("Media download returned an empty file");
    }
    if (bytes.length > limit) {
      throw new ValidationError(`Media is larger than ${limit} bytes`);
    }

    return { ...classified, bytes };
  }

  throw new ValidationError("Media URL redirected too many times");
}
