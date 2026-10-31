import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM. Stored as "v1.<iv>.<tag>.<ciphertext>" (base64url) so the format can change later.
const VERSION = "v1";

export type Cipher = {
  encrypt(plaintext: string): string;
  decrypt(stored: string): string;
};

/** `keyHex` is 32 bytes as 64 hex characters (ENCRYPTION_KEY). The checker uses the same key. */
export function createCipher(keyHex: string): Cipher {
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32) throw new Error("Encryption key must be 32 bytes (64 hex characters)");

  return {
    encrypt(plaintext) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return [VERSION, iv, tag, ciphertext]
        .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
        .join(".");
    },

    decrypt(stored) {
      const [version, iv, tag, ciphertext] = stored.split(".");
      if (version !== VERSION || !iv || !tag || ciphertext === undefined) {
        throw new Error("Unrecognised encrypted value");
      }
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    },
  };
}
