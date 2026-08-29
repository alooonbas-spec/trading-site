import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/lib/errors";
import { classifyMediaUrl } from "@/lib/media/classify";
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
