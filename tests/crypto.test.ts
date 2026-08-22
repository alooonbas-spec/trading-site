import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  getTokenEncryptionKey,
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

describe("getTokenEncryptionKey", () => {
  afterEach(() => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
  });

  it("fails honestly when TOKEN_ENCRYPTION_KEY is not configured", () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => getTokenEncryptionKey()).toThrow("TOKEN_ENCRYPTION_KEY is not configured");
  });

  it("reads and parses a configured hex key from the environment", () => {
    const hex = randomBytes(32).toString("hex");
    process.env.TOKEN_ENCRYPTION_KEY = hex;
    expect(getTokenEncryptionKey()).toEqual(Buffer.from(hex, "hex"));
  });
});
