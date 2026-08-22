import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UnsupportedActionError, ValidationError } from "@/lib/errors";
import { FACEBOOK_GRAPH_ORIGIN } from "@/social/facebook/graph";
import { FacebookAdapter } from "@/social/facebook/adapter";
import { planFacebookPublish } from "@/social/facebook/publish";
import { selectFacebookPage } from "@/social/facebook/pages";
import { InstagramAdapter } from "@/social/instagram/adapter";
import { INSTAGRAM_GRAPH_ORIGIN, planInstagramPublish } from "@/social/instagram/publish";
import { getSocialAdapter } from "@/social/core/registry";
import { VkAdapter } from "@/social/vk/adapter";
import { vkMethodUrl } from "@/social/vk/api";
import { planVkPublish, vkWallTarget } from "@/social/vk/publish";

describe("Facebook Page publishing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("plans feed, photo, album, and video posts and rejects mixed types", () => {
    expect(planFacebookPublish({ body: "Hello page", media: [] })).toEqual({
      type: "feed",
      message: "Hello page",
    });
    expect(planFacebookPublish({ body: "Shot", media: ["https://cdn.example/a.jpg"] })).toEqual({
      type: "photo",
      url: "https://cdn.example/a.jpg",
      caption: "Shot",
    });
    expect(
      planFacebookPublish({
        body: "Album",
        media: ["https://cdn.example/a.jpg", "https://cdn.example/b.png"],
      }),
    ).toEqual({
      type: "photos",
      urls: ["https://cdn.example/a.jpg", "https://cdn.example/b.png"],
      message: "Album",
    });
    expect(planFacebookPublish({ body: "Clip", media: ["https://cdn.example/a.mp4"] }).type).toBe("video");
    expect(() =>
      planFacebookPublish({
        body: "Nope",
        media: ["https://cdn.example/a.jpg", "https://cdn.example/a.mp4"],
      }),
    ).toThrow(ValidationError);
    expect(() => planFacebookPublish({ body: "Nope", media: ["http://127.0.0.1/a.jpg"] })).toThrow(
      ValidationError,
    );
  });

  it("requires a Page id when the user manages more than one Page", () => {
    const pages = [
      { id: "111", name: "Brand", accessToken: "page-a" },
      { id: "222", name: "Shop", accessToken: "page-b" },
    ];
    expect(selectFacebookPage(pages, { pageId: "222" }).id).toBe("222");
    expect(() => selectFacebookPage(pages, {})).toThrow(ValidationError);
    expect(selectFacebookPage([pages[0]!], {}).id).toBe("111");
  });

  it("publishes text through the official Page feed endpoint", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      if (target.startsWith(`${FACEBOOK_GRAPH_ORIGIN}/me/accounts`)) {
        return new Response(
          JSON.stringify({
            data: [{ id: "555", name: "Hub Page", access_token: "page-token" }],
          }),
          { status: 200 },
        );
      }
      expect(target).toBe(`${FACEBOOK_GRAPH_ORIGIN}/555/feed`);
      expect(init?.method).toBe("POST");
      expect(String(init?.body)).toContain("message=Launch");
      expect(String(init?.body)).toContain("access_token=page-token");
      return new Response(JSON.stringify({ id: "555_9" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const published = await new FacebookAdapter({ accessToken: "user-token" }).publish({
      workspaceId: "w",
      socialAccountId: "a",
      body: "Launch",
      media: [],
    });
    expect(published.externalPostId).toBe("555_9");
  });

  it("publishes a photo URL through the official Page photos endpoint", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      if (target.startsWith(`${FACEBOOK_GRAPH_ORIGIN}/me/accounts`)) {
        return new Response(
          JSON.stringify({
            data: [
              { id: "555", name: "Hub Page", access_token: "page-token" },
              { id: "777", name: "Other", access_token: "other-token" },
            ],
          }),
          { status: 200 },
        );
      }
      expect(target).toBe(`${FACEBOOK_GRAPH_ORIGIN}/555/photos`);
      expect(String(init?.body)).toContain("url=https%3A%2F%2Fcdn.example%2Fphoto.jpg");
      expect(String(init?.body)).toContain("published=true");
      return new Response(JSON.stringify({ id: "photo-1", post_id: "555_12" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const published = await new FacebookAdapter({
      accessToken: "user-token",
      metadata: { pageId: "555" },
    }).publish({
      workspaceId: "w",
      socialAccountId: "a",
      body: "Photo",
      media: ["https://cdn.example/photo.jpg"],
    });
    expect(published.externalPostId).toBe("555_12");
  });
});

describe("Instagram content publishing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requires jpeg/png or a single mp4 and rejects text-only posts", () => {
    expect(() => planInstagramPublish({ body: "Hello", media: [] })).toThrow(ValidationError);
    expect(planInstagramPublish({ body: "Shot", media: ["https://cdn.example/a.jpg"] })).toEqual({
      type: "image",
      url: "https://cdn.example/a.jpg",
      caption: "Shot",
    });
    expect(
      planInstagramPublish({
        body: "Album",
        media: ["https://cdn.example/a.jpg", "https://cdn.example/b.png"],
      }).type,
    ).toBe("carousel");
    expect(planInstagramPublish({ body: "Reel", media: ["https://cdn.example/a.mp4"] }).type).toBe("reel");
    expect(() => planInstagramPublish({ body: "Nope", media: ["https://cdn.example/a.gif"] })).toThrow(
      ValidationError,
    );
  });

  it("creates an image container then publishes through media_publish", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      if (target === `${INSTAGRAM_GRAPH_ORIGIN}/1784/media` && init?.method === "POST") {
        expect(String(init.body)).toContain("image_url=https%3A%2F%2Fcdn.example%2Fphoto.jpg");
        expect(String(init.body)).toContain("caption=Launch");
        return new Response(JSON.stringify({ id: "container-1" }), { status: 200 });
      }
      if (target.startsWith(`${INSTAGRAM_GRAPH_ORIGIN}/container-1?`)) {
        return new Response(JSON.stringify({ status_code: "FINISHED" }), { status: 200 });
      }
      if (target === `${INSTAGRAM_GRAPH_ORIGIN}/1784/media_publish`) {
        expect(String(init?.body)).toContain("creation_id=container-1");
        return new Response(JSON.stringify({ id: "media-9" }), { status: 200 });
      }
      throw new Error(`unexpected fetch ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const published = await new InstagramAdapter({
      accessToken: "ig-token",
      metadata: { instagramUserId: "1784" },
    }).publish({
      workspaceId: "w",
      socialAccountId: "a",
      body: "Launch",
      media: ["https://cdn.example/photo.jpg"],
    });
    expect(published.externalPostId).toBe("media-9");
  });
});

describe("VK wall publishing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("plans text and photo posts and parses community owner ids", () => {
    expect(planVkPublish({ body: "Hello wall", media: [] })).toEqual({
      type: "text",
      message: "Hello wall",
    });
    expect(vkWallTarget({ publishOwnerId: "-123" })).toEqual({
      ownerId: "-123",
      groupId: "123",
      fromGroup: true,
    });
    expect(planVkPublish({ body: "Clip", media: ["https://cdn.example/a.mp4"] })).toEqual({
      type: "video",
      url: "https://cdn.example/a.mp4",
      message: "Clip",
    });
  });

  it("posts text through official wall.post", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe(vkMethodUrl("wall.post"));
      expect(String(init?.body)).toContain("message=Hello+wall");
      expect(String(init?.body)).toContain("access_token=vk-token");
      return new Response(JSON.stringify({ response: { post_id: 44 } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const published = await new VkAdapter({ accessToken: "vk-token" }).publish({
      workspaceId: "w",
      socialAccountId: "a",
      body: "Hello wall",
      media: [],
    });
    expect(published.externalPostId).toBe("44");
  });

  it("uploads a wall photo then posts the attachment", async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      if (target === "https://example.com/photo.jpg") {
        return new Response(jpeg, { status: 200, headers: { "content-type": "image/jpeg" } });
      }
      if (target === vkMethodUrl("photos.getWallUploadServer")) {
        return new Response(
          JSON.stringify({ response: { upload_url: "https://example.com/vk-upload" } }),
          { status: 200 },
        );
      }
      if (target === "https://example.com/vk-upload") {
        expect(init?.body).toBeInstanceOf(FormData);
        return new Response(JSON.stringify({ server: 1, photo: "[photo]", hash: "abc" }), { status: 200 });
      }
      if (target === vkMethodUrl("photos.saveWallPhoto")) {
        return new Response(
          JSON.stringify({ response: [{ id: 9, owner_id: 7 }] }),
          { status: 200 },
        );
      }
      if (target === vkMethodUrl("wall.post")) {
        expect(String(init?.body)).toContain("attachments=photo7_9");
        expect(String(init?.body)).toContain("message=Photo");
        return new Response(JSON.stringify({ response: { post_id: 50 } }), { status: 200 });
      }
      throw new Error(`unexpected fetch ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const published = await new VkAdapter({ accessToken: "vk-token" }).publish({
      workspaceId: "w",
      socialAccountId: "a",
      body: "Photo",
      media: ["https://example.com/photo.jpg"],
    });
    expect(published.externalPostId).toBe("50");
  });

  it("uploads a wall video through video.save then posts the attachment", async () => {
    const mp4 = Buffer.from([0, 1, 2, 3]);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      if (target === "https://example.com/clip.mp4") {
        return new Response(mp4, { status: 200, headers: { "content-type": "video/mp4" } });
      }
      if (target === vkMethodUrl("video.save")) {
        return new Response(
          JSON.stringify({
            response: {
              upload_url: "https://example.com/vk-video-upload",
              video_id: 12,
              owner_id: 7,
              access_key: "secret",
            },
          }),
          { status: 200 },
        );
      }
      if (target === "https://example.com/vk-video-upload") {
        expect(init?.body).toBeInstanceOf(FormData);
        return new Response(JSON.stringify({ size: mp4.length }), { status: 200 });
      }
      if (target === vkMethodUrl("wall.post")) {
        expect(String(init?.body)).toContain("attachments=video7_12_secret");
        expect(String(init?.body)).toContain("message=Clip");
        return new Response(JSON.stringify({ response: { post_id: 60 } }), { status: 200 });
      }
      throw new Error(`unexpected fetch ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const published = await new VkAdapter({ accessToken: "vk-token" }).publish({
      workspaceId: "w",
      socialAccountId: "a",
      body: "Clip",
      media: ["https://example.com/clip.mp4"],
    });
    expect(published.externalPostId).toBe("60");
  });

  it("rejects a zero owner id in either sign, and resolves a positive owner id to a personal wall", () => {
    // "0"/"-0" are not valid VK user or community ids -- posting there would
    // silently target the wrong wall (or VK's own error), so this must fail
    // fast in vkWallTarget rather than reach wall.post at all.
    expect(() => vkWallTarget({ publishOwnerId: "0" })).toThrow(ValidationError);
    expect(() => vkWallTarget({ publishOwnerId: "-0" })).toThrow(ValidationError);
    expect(vkWallTarget({ publishOwnerId: "555" })).toEqual({
      ownerId: "555",
      groupId: null,
      fromGroup: false,
    });
    expect(vkWallTarget(undefined)).toEqual({ ownerId: null, groupId: null, fromGroup: false });
  });
});

describe("PHASE 12 capabilities and source boundaries", () => {
  it("enables official publish and keeps VK contact unsupported", async () => {
    for (const platform of ["facebook", "instagram", "vk"] as const) {
      const adapter = getSocialAdapter(platform);
      expect((await adapter.getCapabilities()).publishing).toBe(true);
    }
    expect((await getSocialAdapter("vk").getCapabilities()).contactActions).toBe(false);
    await expect(
      getSocialAdapter("vk").executeContactAction({
        workspaceId: "w",
        socialAccountId: "a",
        socialProfileId: "p",
        leadId: "l",
        action: "MESSAGE",
      }),
    ).rejects.toBeInstanceOf(UnsupportedActionError);
  });

  it("keeps platform switches out of the worker and uses official endpoints", () => {
    const worker = readFileSync("services/jobs/worker-service.ts", "utf8");
    expect(worker).not.toMatch(/if\s*\(\s*platform\s*===/);
    expect(worker).toContain("adapter.publish");
    expect(readFileSync("social/facebook/publish.ts", "utf8")).toContain("/photos");
    expect(readFileSync("social/instagram/publish.ts", "utf8")).toContain("media_publish");
    expect(readFileSync("social/vk/publish.ts", "utf8")).toContain("wall.post");
    expect(readFileSync("social/facebook/graph.ts", "utf8")).toContain("pages_manage_posts");
    expect(readFileSync("social/instagram/publish.ts", "utf8")).toContain("instagram_business_content_publish");
    expect(readFileSync("social/vk/api.ts", "utf8")).toContain("wall photos");
  });
});
