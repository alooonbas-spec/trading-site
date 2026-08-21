import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  parseEncryptionKey,
} from "@/lib/crypto/token-encryption";

describe("token encryption", () => {
  it("round-trips a secret with a 32-byte key", () => {
    const key = parseEncryptionKey(randomBytes(32).toString("hex"));
    const payload = encryptSecret("access-token-value", key);
    expect(payload.startsWith("v1:")).toBe(true);
    expect(decryptSecret(payload, key)).toBe("access-token-value");
  });

  it("rejects a malformed key", () => {
    expect(() => parseEncryptionKey("too-short")).toThrow(/32 bytes/);
  });
});
