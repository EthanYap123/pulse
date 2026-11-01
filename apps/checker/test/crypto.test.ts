import { describe, expect, it } from "vitest";
import { createDecrypt } from "../src/crypto.js";
import { ENCRYPTED_FIXTURE as FROM_API, FIXTURE_KEY } from "./helpers.js";

describe("createDecrypt", () => {
  it("decrypts values the API encrypted", async () => {
    const decrypt = await createDecrypt(FIXTURE_KEY);
    expect(await decrypt(FROM_API)).toBe("Bearer fixture-token");
  });

  it("fails with the wrong key", async () => {
    const decrypt = await createDecrypt("22".repeat(32));
    await expect(decrypt(FROM_API)).rejects.toThrow();
  });

  it("rejects values in another format", async () => {
    const decrypt = await createDecrypt(FIXTURE_KEY);
    await expect(decrypt("plain")).rejects.toThrow(/Unrecognised/);
  });

  it("rejects a malformed key", async () => {
    await expect(createDecrypt("abc")).rejects.toThrow(/64 hex/);
  });
});
