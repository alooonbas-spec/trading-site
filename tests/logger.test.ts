import { describe, expect, it, vi } from "vitest";
import { logger } from "@/lib/logger";

describe("logger redaction", () => {
  it("redacts tokens, secrets, and api keys", () => {
    const redacted = logger.redact({
      access_token: "super-secret",
      refreshToken: "also-secret",
      apiKey: "key",
      workspaceId: "abc",
    });

    expect(redacted.access_token).toBe("[redacted]");
    expect(redacted.refreshToken).toBe("[redacted]");
    expect(redacted.apiKey).toBe("[redacted]");
    expect(redacted.workspaceId).toBe("abc");
  });

  it("redacts case-insensitively, including cookie and authorization", () => {
    const redacted = logger.redact({
      PASSWORD: "hunter2",
      Authorization: "Bearer xyz",
      Cookie: "session=abc",
      Token: "t",
    });
    expect(redacted.PASSWORD).toBe("[redacted]");
    expect(redacted.Authorization).toBe("[redacted]");
    expect(redacted.Cookie).toBe("[redacted]");
    expect(redacted.Token).toBe("[redacted]");
  });

  it("redacts secrets nested inside plain objects", () => {
    const redacted = logger.redact({
      account: { id: "acc-1", access_token_encrypted: "secret", metadata: { note: "ok" } },
    });
    expect(redacted.account).toEqual({
      id: "acc-1",
      access_token_encrypted: "[redacted]",
      metadata: { note: "ok" },
    });
  });

  it("redacts secrets nested inside arrays of objects", () => {
    const redacted = logger.redact({
      accounts: [
        { name: "acc-a", refreshToken: "a-secret" },
        { name: "acc-b", refreshToken: "b-secret" },
      ],
    });
    expect(redacted.accounts).toEqual([
      { name: "acc-a", refreshToken: "[redacted]" },
      { name: "acc-b", refreshToken: "[redacted]" },
    ]);
  });

  it("leaves non-secret primitives, null, and arrays of primitives untouched", () => {
    const redacted = logger.redact({ count: 3, active: true, note: null, tags: ["a", "b"] });
    expect(redacted).toEqual({ count: 3, active: true, note: null, tags: ["a", "b"] });
  });
});

describe("logger level routing", () => {
  it("routes info, warn, and error to the matching console method with redacted meta", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    logger.info("job claimed", { jobId: "j1" });
    logger.warn("token refresh retrying", { accessToken: "leaky" });
    logger.error("job failed", { lastError: "boom" });

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy.mock.calls[0]?.[0]).toMatchObject({ level: "info", message: "job claimed" });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatchObject({
      level: "warn",
      message: "token refresh retrying",
      meta: { accessToken: "[redacted]" },
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[0]).toMatchObject({ level: "error", message: "job failed" });

    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("omits meta entirely when none is passed", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    logger.info("no meta here");
    expect(infoSpy.mock.calls[0]?.[0]).not.toHaveProperty("meta");
    infoSpy.mockRestore();
  });
});
