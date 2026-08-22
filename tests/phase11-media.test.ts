import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/lib/errors";
import { classifyMediaUrl, fileExtension } from "@/lib/media/classify";
import { isPrivateOrLocalIp, parsePublicMediaUrl } from "@/lib/media/public-url";
import { TelegramAdapter, telegramMethodUrl } from "@/social/telegram/adapter";
import { buildTelegramMediaPayload } from "@/social/telegram/media";
import { XAdapter } from "@/social/x/adapter";
import { X_MEDIA_INITIALIZE_URL } from "@/social/x/media-upload";

describe("public media URLs", () => {
  it("classifies common extensions", () => {
    expect(classifyMediaUrl("https://cdn.example/a.jpg").kind).toBe("photo");
    expect(classifyMediaUrl("https://cdn.example/a.gif").kind).toBe("gif");
    expect(classifyMediaUrl("https://cdn.example/a.mp4").kind).toBe("video");
    expect(classifyMediaUrl("https://cdn.example/a.pdf").kind).toBe("document");
  });

  it("rejects private hosts and credentialed URLs", () => {
    expect(() => parsePublicMediaUrl("http://127.0.0.1/photo.jpg")).toThrow(ValidationError);
    expect(() => parsePublicMediaUrl("http://192.168.0.12/photo.jpg")).toThrow(ValidationError);
    expect(() => parsePublicMediaUrl("http://localhost/photo.jpg")).toThrow(ValidationError);
    expect(() => parsePublicMediaUrl("https://user:pass@example.com/photo.jpg")).toThrow(ValidationError);
    expect(isPrivateOrLocalIp("10.1.2.3")).toBe(true);
    expect(isPrivateOrLocalIp("1.1.1.1")).toBe(false);
  });

  it("blocks the cloud instance-metadata IP and the carrier-grade NAT range", () => {
    // 169.254.169.254 serves cloud credentials on AWS/GCP/Azure if reachable.
    expect(isPrivateOrLocalIp("169.254.169.254")).toBe(true);
    expect(isPrivateOrLocalIp("100.64.0.1")).toBe(true);
    expect(isPrivateOrLocalIp("100.127.255.254")).toBe(true);
    expect(isPrivateOrLocalIp("100.128.0.0")).toBe(false);
  });

  it("respects the exact CIDR boundaries for the 172.16.0.0/12 private range", () => {
    expect(isPrivateOrLocalIp("172.15.255.255")).toBe(false);
    expect(isPrivateOrLocalIp("172.16.0.0")).toBe(true);
    expect(isPrivateOrLocalIp("172.31.255.255")).toBe(true);
    expect(isPrivateOrLocalIp("172.32.0.0")).toBe(false);
  });

  it("blocks loopback, link-local, and unique-local IPv6 addresses, including IPv4-mapped ones", () => {
    expect(isPrivateOrLocalIp("::1")).toBe(true);
    expect(isPrivateOrLocalIp("fe80::1")).toBe(true);
    expect(isPrivateOrLocalIp("fc00::1")).toBe(true);
    expect(isPrivateOrLocalIp("fd12:3456::1")).toBe(true);
    expect(isPrivateOrLocalIp("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateOrLocalIp("2001:4860:4860::8888")).toBe(false);
  });

  it("blocks the documented internal hostname suffixes and the cloud metadata hostname", () => {
    expect(() => parsePublicMediaUrl("https://metadata.google.internal/latest")).toThrow(ValidationError);
    expect(() => parsePublicMediaUrl("https://box.internal/photo.jpg")).toThrow(ValidationError);
    expect(() => parsePublicMediaUrl("https://printer.local/photo.jpg")).toThrow(ValidationError);
  });

  it("rejects a non-http(s) scheme", () => {
    expect(() => parsePublicMediaUrl("ftp://example.com/photo.jpg")).toThrow(ValidationError);
    expect(() => parsePublicMediaUrl("file:///etc/passwd")).toThrow(ValidationError);
  });

  it("accepts an ordinary public https URL", () => {
    expect(parsePublicMediaUrl("https://cdn.example.com/photo.jpg").hostname).toBe("cdn.example.com");
  });

  it("distinguishes mime type variants that share an extension bucket", () => {
    expect(classifyMediaUrl("https://cdn.example/a.png").mimeType).toBe("image/png");
    expect(classifyMediaUrl("https://cdn.example/a.webp").mimeType).toBe("image/webp");
    expect(classifyMediaUrl("https://cdn.example/a.jpeg").mimeType).toBe("image/jpeg");
    expect(classifyMediaUrl("https://cdn.example/a.webm").mimeType).toBe("video/webm");
    expect(classifyMediaUrl("https://cdn.example/a.mov").mimeType).toBe("video/quicktime");
    expect(classifyMediaUrl("https://cdn.example/a.zip").mimeType).toBe("application/zip");
  });

  it("maps bmp and tif/tiff extensions to their own mime types, not a jpeg fallback", () => {
    // The extension-based mimeType inference used to default anything that
    // wasn't png/webp to "image/jpeg" -- including bmp and tif/tiff, which
    // are real, distinct PHOTO_EXTENSION_MIME entries. That silently mislabeled
    // bmp/tiff media as jpeg, letting it pass a platform's jpeg/png-only mime
    // check (e.g. Instagram's) even though the actual bytes are not a jpeg.
    expect(classifyMediaUrl("https://cdn.example/a.bmp").mimeType).toBe("image/bmp");
    expect(classifyMediaUrl("https://cdn.example/a.tif").mimeType).toBe("image/tiff");
    expect(classifyMediaUrl("https://cdn.example/a.tiff").mimeType).toBe("image/tiff");
  });

  it("prefers an explicit content-type over the URL extension when both are present", () => {
    const classified = classifyMediaUrl("https://cdn.example/download?id=1", "image/png; charset=binary");
    expect(classified.kind).toBe("photo");
    expect(classified.mimeType).toBe("image/png");
  });

  it("falls back to the extension when content-type is missing or unrecognized", () => {
    expect(classifyMediaUrl("https://cdn.example/a.mp4", null).kind).toBe("video");
    expect(classifyMediaUrl("https://cdn.example/a.mp4", "application/octet-stream").kind).toBe("video");
  });

  it("rejects a URL with no classifiable extension or content-type", () => {
    expect(() => classifyMediaUrl("https://cdn.example/a.exe")).toThrow(ValidationError);
    expect(() => classifyMediaUrl("https://cdn.example/no-extension")).toThrow(ValidationError);
  });

  it("extracts a lowercased file extension, tolerating query strings and missing extensions", () => {
    expect(fileExtension("https://cdn.example/a.JPG")).toBe("jpg");
    expect(fileExtension("https://cdn.example/path/a.mp4?token=abc")).toBe("mp4");
    expect(fileExtension("https://cdn.example/no-extension")).toBe("");
    expect(fileExtension("not a url")).toBe("");
  });
});

describe("Telegram media publishing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds sendPhoto for a single image URL", () => {
    expect(
      buildTelegramMediaPayload({
        chatId: "@hub_channel",
        body: "Hello channel",
        media: ["https://cdn.example/photo.jpg"],
      }),
    ).toEqual({
      method: "sendPhoto",
      body: {
        chat_id: "@hub_channel",
        photo: "https://cdn.example/photo.jpg",
        caption: "Hello channel",
      },
    });
  });

  it("groups photos and videos into a single sendMediaGroup, not documents or GIFs", () => {
    expect(
      buildTelegramMediaPayload({
        chatId: "@hub_channel",
        body: "Launch week",
        media: ["https://cdn.example/a.jpg", "https://cdn.example/b.mp4"],
      }),
    ).toEqual({
      method: "sendMediaGroup",
      body: {
        chat_id: "@hub_channel",
        media: [
          { type: "photo", media: "https://cdn.example/a.jpg", caption: "Launch week" },
          { type: "video", media: "https://cdn.example/b.mp4" },
        ],
      },
    });
  });

  it("rejects a GIF grouped with any other media, including another GIF", () => {
    // sendMediaGroup only accepts InputMediaAudio/Document/Photo/Video --
    // Telegram has no group form of animation at all, unlike documents,
    // which are only barred from mixing with photos/videos.
    expect(() =>
      buildTelegramMediaPayload({
        chatId: "@hub_channel",
        body: "",
        media: ["https://cdn.example/a.gif", "https://cdn.example/b.jpg"],
      }),
    ).toThrow(ValidationError);
    expect(() =>
      buildTelegramMediaPayload({
        chatId: "@hub_channel",
        body: "",
        media: ["https://cdn.example/a.gif", "https://cdn.example/b.gif"],
      }),
    ).toThrow(ValidationError);
  });

  it("rejects a document grouped with a photo or video", () => {
    expect(() =>
      buildTelegramMediaPayload({
        chatId: "@hub_channel",
        body: "",
        media: ["https://cdn.example/a.pdf", "https://cdn.example/b.jpg"],
      }),
    ).toThrow(ValidationError);
  });

  it("publishes a photo through official sendPhoto", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(telegramMethodUrl("123456:ABC-token_value", "sendPhoto"));
      expect(JSON.parse(String(init?.body))).toEqual({
        chat_id: "@hub_channel",
        photo: "https://cdn.example/photo.jpg",
        caption: "Launch",
      });
      return new Response(
        JSON.stringify({
          ok: true,
          result: { message_id: 11, chat: { id: -100, username: "hub_channel" } },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const published = await new TelegramAdapter({
      accessToken: "123456:ABC-token_value",
      metadata: { publishChatId: "@hub_channel" },
    }).publish({
      workspaceId: "w",
      socialAccountId: "a",
      body: "Launch",
      media: ["https://cdn.example/photo.jpg"],
    });
    expect(published.externalPostId).toBe("-100:11");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("publishes an album through official sendMediaGroup", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(telegramMethodUrl("123456:ABC-token_value", "sendMediaGroup"));
      expect(JSON.parse(String(init?.body))).toEqual({
        chat_id: "@hub_channel",
        media: [
          { type: "photo", media: "https://cdn.example/a.jpg", caption: "Album" },
          { type: "photo", media: "https://cdn.example/b.jpg" },
        ],
      });
      return new Response(
        JSON.stringify({
          ok: true,
          result: [{ message_id: 12, chat: { id: -100, username: "hub_channel" } }],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const published = await new TelegramAdapter({
      accessToken: "123456:ABC-token_value",
      metadata: { publishChatId: "hub_channel" },
    }).publish({
      workspaceId: "w",
      socialAccountId: "a",
      body: "Album",
      media: ["https://cdn.example/a.jpg", "https://cdn.example/b.jpg"],
    });
    expect(published.externalPostId).toBe("-100:12");
  });

  it("rejects local media URLs before calling Telegram", async () => {
    await expect(
      new TelegramAdapter({
        accessToken: "123456:ABC-token_value",
        metadata: { publishChatId: "@hub_channel" },
      }).publish({
        workspaceId: "w",
        socialAccountId: "a",
        body: "Nope",
        media: ["http://127.0.0.1/secret.jpg"],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("X media publishing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uploads through initialize/append/finalize then posts media_ids", async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      if (target === "https://example.com/photo.jpg") {
        return new Response(jpeg, { status: 200, headers: { "content-type": "image/jpeg" } });
      }
      if (target === X_MEDIA_INITIALIZE_URL) {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        expect(body).toMatchObject({
          media_type: "image/jpeg",
          media_category: "tweet_image",
          total_bytes: jpeg.length,
        });
        return new Response(JSON.stringify({ data: { id: "777" } }), { status: 200 });
      }
      if (target === "https://api.x.com/2/media/upload/777/append") {
        expect(init?.method).toBe("POST");
        expect(init?.body).toBeInstanceOf(FormData);
        return new Response(JSON.stringify({ data: {} }), { status: 200 });
      }
      if (target === "https://api.x.com/2/media/upload/777/finalize") {
        return new Response(JSON.stringify({ data: { id: "777" } }), { status: 200 });
      }
      if (target === "https://api.x.com/2/tweets") {
        expect(JSON.parse(String(init?.body))).toEqual({
          text: "Photo of the day",
          media: { media_ids: ["777"] },
        });
        return new Response(JSON.stringify({ data: { id: "tweet-9", text: "Photo of the day" } }), { status: 201 });
      }
      throw new Error(`unexpected fetch ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const published = await new XAdapter({ accessToken: "x-token" }).publish({
      workspaceId: "w",
      socialAccountId: "a",
      body: "Photo of the day",
      media: ["https://example.com/photo.jpg"],
    });
    expect(published.externalPostId).toBe("tweet-9");
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe("PHASE 11 source boundaries", () => {
  it("keeps media upload inside adapters", () => {
    const worker = readFileSync("services/jobs/worker-service.ts", "utf8");
    expect(worker).not.toMatch(/if\s*\(\s*platform\s*===/);
    expect(worker).toContain("adapter.publish");
    expect(readFileSync("social/x/adapter.ts", "utf8")).toContain("media.write");
    expect(readFileSync("social/x/media-upload.ts", "utf8")).toContain("https://api.x.com/2/media/upload/initialize");
    expect(readFileSync("social/telegram/media.ts", "utf8")).toContain("sendPhoto");
  });
});
