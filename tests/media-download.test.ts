import { afterEach, describe, expect, it, vi } from "vitest";
import { NetworkError, ValidationError } from "@/lib/errors";
import { downloadPublicMedia, MAX_IMAGE_BYTES } from "@/lib/media/download";

describe("downloadPublicMedia", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("downloads and classifies a public image", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe("https://example.com/photo.jpg");
      expect(init?.redirect).toBe("manual");
      return new Response(bytes, { status: 200, headers: { "content-type": "image/jpeg" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await downloadPublicMedia("https://example.com/photo.jpg");
    expect(result.kind).toBe("photo");
    expect(result.mimeType).toBe("image/jpeg");
    expect(Buffer.from(result.bytes)).toEqual(Buffer.from(bytes));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("follows a redirect to the final resource, re-checking the host on the new URL", async () => {
    const bytes = new Uint8Array([9, 9, 9]);
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url) === "https://example.com/redirect") {
        return new Response(null, { status: 302, headers: { location: "https://example.com/final.jpg" } });
      }
      expect(String(url)).toBe("https://example.com/final.jpg");
      return new Response(bytes, { status: 200, headers: { "content-type": "image/jpeg" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await downloadPublicMedia("https://example.com/redirect");
    expect(Buffer.from(result.bytes)).toEqual(Buffer.from(bytes));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuses a redirect that points at a private or link-local IP, even mid-chain", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url) === "https://example.com/redirect") {
        // 169.254.169.254 is the cloud-provider instance-metadata endpoint.
        return new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data/" },
        });
      }
      throw new Error(`must not fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(downloadPublicMedia("https://example.com/redirect")).rejects.toThrow(ValidationError);
  });

  it("gives up after too many redirects instead of following forever", async () => {
    let hop = 0;
    const fetchMock = vi.fn(async () => {
      hop += 1;
      return new Response(null, { status: 302, headers: { location: `https://example.com/hop-${hop}` } });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(downloadPublicMedia("https://example.com/start")).rejects.toThrow(
      "redirected too many times",
    );
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it("rejects a redirect response with no Location header", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 302 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(downloadPublicMedia("https://example.com/redirect")).rejects.toThrow(
      "redirected without a Location header",
    );
  });

  it("rejects a non-ok, non-redirect response", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(downloadPublicMedia("https://example.com/missing.jpg")).rejects.toThrow(
      "HTTP 404",
    );
  });

  it("rejects media that declares a content-length over the limit before downloading the body", async () => {
    const fetchMock = vi.fn(async () => {
      const response = new Response(new Uint8Array([1]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
      response.headers.set("content-length", String(MAX_IMAGE_BYTES + 1));
      return response;
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(downloadPublicMedia("https://example.com/huge.jpg")).rejects.toThrow(
      `Media is larger than ${MAX_IMAGE_BYTES} bytes`,
    );
  });

  it("rejects media whose actual body exceeds the limit even when content-length under-declares it", async () => {
    const oversized = new Uint8Array(MAX_IMAGE_BYTES + 1);
    const fetchMock = vi.fn(async () => {
      const response = new Response(oversized, {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
      response.headers.set("content-length", "1");
      return response;
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(downloadPublicMedia("https://example.com/lying-header.jpg")).rejects.toThrow(
      `Media is larger than ${MAX_IMAGE_BYTES} bytes`,
    );
  });

  it("rejects an empty download", async () => {
    const fetchMock = vi.fn(
      async () => new Response(new Uint8Array([]), { status: 200, headers: { "content-type": "image/jpeg" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(downloadPublicMedia("https://example.com/empty.jpg")).rejects.toThrow(
      "empty file",
    );
  });

  it("wraps a network failure in NetworkError", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(downloadPublicMedia("https://example.com/photo.jpg")).rejects.toBeInstanceOf(
      NetworkError,
    );
  });

  it("refuses a raw private IP source before making any request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(downloadPublicMedia("http://127.0.0.1/photo.jpg")).rejects.toThrow(ValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
