import { describe, expect, it } from "vitest";
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
});
