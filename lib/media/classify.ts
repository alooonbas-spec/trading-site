import { ValidationError } from "@/lib/errors";

export const MEDIA_KINDS = ["photo", "gif", "video", "document"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export type ClassifiedMedia = {
  url: string;
  kind: MediaKind;
  mimeType: string;
};

const PHOTO_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "bmp", "tif", "tiff"]);
const GIF_EXTENSIONS = new Set(["gif"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm", "m4v"]);
const DOCUMENT_EXTENSIONS = new Set(["pdf", "zip"]);

const MIME_TO_KIND: Record<string, { kind: MediaKind; mimeType: string }> = {
  "image/jpeg": { kind: "photo", mimeType: "image/jpeg" },
  "image/jpg": { kind: "photo", mimeType: "image/jpeg" },
  "image/png": { kind: "photo", mimeType: "image/png" },
  "image/webp": { kind: "photo", mimeType: "image/webp" },
  "image/bmp": { kind: "photo", mimeType: "image/bmp" },
  "image/tiff": { kind: "photo", mimeType: "image/tiff" },
  "image/gif": { kind: "gif", mimeType: "image/gif" },
  "video/mp4": { kind: "video", mimeType: "video/mp4" },
  "video/quicktime": { kind: "video", mimeType: "video/quicktime" },
  "video/webm": { kind: "video", mimeType: "video/webm" },
  "application/pdf": { kind: "document", mimeType: "application/pdf" },
  "application/zip": { kind: "document", mimeType: "application/zip" },
};

export function fileExtension(source: string): string {
  try {
    const url = new URL(source);
    const name = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
    const dot = name.lastIndexOf(".");
    if (dot < 0) {
      return "";
    }
    return name.slice(dot + 1).toLowerCase();
  } catch {
    return "";
  }
}

export function classifyMediaUrl(source: string, contentType?: string | null): ClassifiedMedia {
  const mime = contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (mime && MIME_TO_KIND[mime]) {
    return { url: source, ...MIME_TO_KIND[mime] };
  }

  const extension = fileExtension(source);
  if (PHOTO_EXTENSIONS.has(extension)) {
    return {
      url: source,
      kind: "photo",
      mimeType: extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg",
    };
  }
  if (GIF_EXTENSIONS.has(extension)) {
    return { url: source, kind: "gif", mimeType: "image/gif" };
  }
  if (VIDEO_EXTENSIONS.has(extension)) {
    return {
      url: source,
      kind: "video",
      mimeType: extension === "webm" ? "video/webm" : extension === "mov" ? "video/quicktime" : "video/mp4",
    };
  }
  if (DOCUMENT_EXTENSIONS.has(extension)) {
    return {
      url: source,
      kind: "document",
      mimeType: extension === "zip" ? "application/zip" : "application/pdf",
    };
  }

  throw new ValidationError(
    "Unsupported media type. Use jpeg, png, webp, gif, mp4, webm, mov, pdf, or zip URLs.",
  );
}
