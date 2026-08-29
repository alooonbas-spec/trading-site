import { afterEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/lib/errors";
import { VkAdapter } from "@/social/vk/adapter";
import { VK_SCOPES, vkMethodUrl } from "@/social/vk/api";
import { planVkPublish } from "@/social/vk/publish";

describe("VK video publishing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("plans a single mp4 or mov and rejects mixes, webm, and documents", () => {
    expect(planVkPublish({ body: "Clip", media: ["https://cdn.example/a.mp4"] })).toEqual({
      type: "video",
      url: "https://cdn.example/a.mp4",
      message: "Clip",
    });
    expect(planVkPublish({ body: "Clip", media: ["https://cdn.example/a.mov"] }).type).toBe("video");
    expect(() =>
      planVkPublish({
        body: "Nope",
        media: ["https://cdn.example/a.jpg", "https://cdn.example/a.mp4"],
      }),
    ).toThrow(ValidationError);
    expect(() => planVkPublish({ body: "Nope", media: ["https://cdn.example/a.webm"] })).toThrow(
      ValidationError,
    );
    expect(() => planVkPublish({ body: "Nope", media: ["https://cdn.example/a.pdf"] })).toThrow(
      ValidationError,
    );
    expect(VK_SCOPES).toContain("video");
  });

  it("uploads through official video.save then wall.post", async () => {
    const mp4 = Buffer.from("fake-mp4");
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      if (target === "https://example.com/clip.mp4") {
        return new Response(mp4, { status: 200, headers: { "content-type": "video/mp4" } });
      }
      if (target === vkMethodUrl("video.save")) {
        expect(String(init?.body)).toContain("name=Launch");
        expect(String(init?.body)).toContain("wallpost=0");
        expect(String(init?.body)).toContain("group_id=55");
        expect(String(init?.body)).toContain("access_token=vk-token");
        return new Response(
          JSON.stringify({
            response: {
              upload_url: "https://example.com/vk-video-upload",
              video_id: 456,
              owner_id: -55,
              access_key: "vkkey",
            },
          }),
          { status: 200 },
        );
      }
      if (target === "https://example.com/vk-video-upload") {
        expect(init?.body).toBeInstanceOf(FormData);
        const form = init?.body as FormData;
        expect(form.has("video_file")).toBe(true);
        return new Response(JSON.stringify({ size: 8 }), { status: 200 });
      }
      if (target === vkMethodUrl("wall.post")) {
        expect(String(init?.body)).toContain("attachments=video-55_456_vkkey");
        expect(String(init?.body)).toContain("message=Launch");
        expect(String(init?.body)).toContain("owner_id=-55");
        expect(String(init?.body)).toContain("from_group=1");
        return new Response(JSON.stringify({ response: { post_id: 88 } }), { status: 200 });
      }
      throw new Error(`unexpected fetch ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const published = await new VkAdapter({
      accessToken: "vk-token",
      metadata: { publishOwnerId: "-55" },
    }).publish({
      workspaceId: "w",
      socialAccountId: "a",
      body: "Launch",
      media: ["https://example.com/clip.mp4"],
    });
    expect(published.externalPostId).toBe("-55_88");
    expect(fetchMock).toHaveBeenCalled();
  });
});
