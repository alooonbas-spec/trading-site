import { afterEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/lib/errors";
import { assertPublicMediaHost } from "@/lib/media/public-url";

// assertPublicMediaHost's whole point is to catch DNS rebinding: a hostname
// that looks fine but resolves to a private/link-local address. That branch
// depends on a real DNS lookup, so it needs node:dns/promises mocked to be
// tested deterministically (PHASE 90/91 exercised the raw-IP and hostname-
// blocklist paths, which don't touch DNS, but not this one).
const lookupMock = vi.fn();
vi.mock("node:dns/promises", () => ({
  lookup: (...args: unknown[]) => lookupMock(...args),
}));

describe("assertPublicMediaHost", () => {
  afterEach(() => {
    lookupMock.mockReset();
  });

  it("skips DNS resolution entirely when the host is already a raw IP", async () => {
    const url = await assertPublicMediaHost("https://93.184.216.34/photo.jpg");
    expect(url.hostname).toBe("93.184.216.34");
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("allows a hostname that resolves only to public IPs", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    const url = await assertPublicMediaHost("https://cdn.example.com/photo.jpg");
    expect(url.hostname).toBe("cdn.example.com");
    expect(lookupMock).toHaveBeenCalledWith("cdn.example.com", { all: true, verbatim: true });
  });

  it("rejects a hostname that resolves to a private IP (DNS rebinding)", async () => {
    lookupMock.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    await expect(assertPublicMediaHost("https://attacker.example/photo.jpg")).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("rejects a hostname that resolves to the cloud instance-metadata IP", async () => {
    lookupMock.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    await expect(assertPublicMediaHost("https://sneaky.example/photo.jpg")).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("rejects when only one of several DNS records is private", async () => {
    lookupMock.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ]);
    await expect(assertPublicMediaHost("https://mixed.example/photo.jpg")).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("rejects when DNS resolves to no records at all", async () => {
    lookupMock.mockResolvedValue([]);
    await expect(assertPublicMediaHost("https://nowhere.example/photo.jpg")).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
