import { ValidationError } from "@/lib/errors";
import { classifyMediaUrl, type ClassifiedMedia, type MediaKind } from "@/lib/media/classify";
import { parsePublicMediaUrl } from "@/lib/media/public-url";

const TELEGRAM_CAPTION_MAX = 1024;

export type TelegramMediaMethod = "sendPhoto" | "sendAnimation" | "sendVideo" | "sendDocument" | "sendMediaGroup";

export type TelegramMediaPayload = {
  method: TelegramMediaMethod;
  body: Record<string, unknown>;
};

function telegramKind(item: ClassifiedMedia): MediaKind {
  return item.kind;
}

function inputMediaType(kind: MediaKind): "photo" | "animation" | "video" | "document" {
  if (kind === "gif") {
    return "animation";
  }
  if (kind === "photo") {
    return "photo";
  }
  if (kind === "video") {
    return "video";
  }
  return "document";
}

function singleMethod(kind: MediaKind): Exclude<TelegramMediaMethod, "sendMediaGroup"> {
  if (kind === "photo") {
    return "sendPhoto";
  }
  if (kind === "gif") {
    return "sendAnimation";
  }
  if (kind === "video") {
    return "sendVideo";
  }
  return "sendDocument";
}

function mediaField(kind: MediaKind): "photo" | "animation" | "video" | "document" {
  return inputMediaType(kind);
}

export function telegramCaption(body: string): string {
  const caption = body.trim();
  if (caption.length > TELEGRAM_CAPTION_MAX) {
    throw new ValidationError("Telegram media captions cannot exceed 1024 characters");
  }
  return caption;
}

export function buildTelegramMediaPayload(input: {
  chatId: string;
  body: string;
  media: string[];
}): TelegramMediaPayload {
  const items = input.media.map((url) => {
    parsePublicMediaUrl(url);
    return classifyMediaUrl(url);
  });
  const caption = telegramCaption(input.body);
  const kinds = new Set(items.map(telegramKind));
  if (kinds.has("document") && kinds.size > 1) {
    throw new ValidationError("Telegram documents cannot be mixed with photos or videos");
  }
  if (items.length === 1) {
    const item = items[0];
    if (!item) {
      throw new ValidationError("Telegram media is missing");
    }
    return {
      method: singleMethod(item.kind),
      body: {
        chat_id: input.chatId,
        [mediaField(item.kind)]: item.url,
        ...(caption ? { caption } : {}),
      },
    };
  }

  const media = items.map((item, index) => ({
    type: inputMediaType(item.kind),
    media: item.url,
    ...(index === 0 && caption ? { caption } : {}),
  }));
  return {
    method: "sendMediaGroup",
    body: {
      chat_id: input.chatId,
      media,
    },
  };
}
