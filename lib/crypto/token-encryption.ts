import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

export function parseEncryptionKey(raw: string): Buffer {
  const trimmed = raw.trim();

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }

  const fromBase64 = Buffer.from(trimmed, "base64");
  if (fromBase64.length === KEY_LENGTH) {
    return fromBase64;
  }

  throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes encoded as hex or base64");
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  if (key.length !== KEY_LENGTH) {
    throw new Error("Encryption key must be 32 bytes");
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

export function decryptSecret(payload: string, key: Buffer): string {
  if (key.length !== KEY_LENGTH) {
    throw new Error("Encryption key must be 32 bytes");
  }

  const [version, ivPart, tagPart, dataPart] = payload.split(":");
  if (version !== VERSION || !ivPart || !tagPart || !dataPart) {
    throw new Error("Invalid encrypted payload");
  }

  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  const encrypted = Buffer.from(dataPart, "base64url");

  if (iv.length !== IV_LENGTH || tag.length !== AUTH_TAG_LENGTH) {
    throw new Error("Invalid encrypted payload");
  }

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

export function getTokenEncryptionKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("TOKEN_ENCRYPTION_KEY is not configured");
  }

  return parseEncryptionKey(raw);
}
