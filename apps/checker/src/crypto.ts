/**
 * Decrypts values written by the API's AES-256-GCM cipher (apps/api/src/crypto.ts):
 * "v1.<iv>.<tag>.<ciphertext>" in base64url. WebCrypto wants the tag appended to the
 * ciphertext, so the parts are rejoined before decrypting.
 */

export type Decrypt = (stored: string) => Promise<string>;

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "="));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(hex.match(/../g) ?? [], (byte) => parseInt(byte, 16));
}

export async function createDecrypt(keyHex: string): Promise<Decrypt> {
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error("ENCRYPTION_KEY must be 64 hex characters (32 bytes)");
  }
  const key = await crypto.subtle.importKey("raw", fromHex(keyHex), "AES-GCM", false, ["decrypt"]);

  return async (stored) => {
    const [version, iv, tag, ciphertext] = stored.split(".");
    if (version !== "v1" || !iv || !tag || ciphertext === undefined) {
      throw new Error("Unrecognised encrypted value");
    }
    const sealed = new Uint8Array([...fromBase64Url(ciphertext), ...fromBase64Url(tag)]);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64Url(iv) },
      key,
      sealed,
    );
    return new TextDecoder().decode(plain);
  };
}
