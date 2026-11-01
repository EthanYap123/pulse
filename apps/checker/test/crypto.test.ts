import { describe, expect, it } from "vitest";
import { createDecrypt } from "../src/crypto.js";

// Produced by the API's cipher (apps/api/src/crypto.ts) with key "11" x 32.
const FROM_API = "v1.IkUA0CNn5h_ukmbN.6H1MJvTVL6QlGgFafROJfw.28C2C7yCWKuiGFSrJiHO6TKTClk";

describe("createDecrypt", () => {
  it("decrypts values the API encrypted", async () => {
    const decrypt = await createDecrypt("11".repeat(32));
    expect(await decrypt(FROM_API)).toBe("Bearer fixture-token");
  });

  it("fails with the wrong key", async () => {
    const decrypt = await createDecrypt("22".repeat(32));
    await expect(decrypt(FROM_API)).rejects.toThrow();
  });

  it("rejects values in another format", async () => {
    const decrypt = await createDecrypt("11".repeat(32));
    await expect(decrypt("plain")).rejects.toThrow(/Unrecognised/);
  });

  it("rejects a malformed key", async () => {
    await expect(createDecrypt("abc")).rejects.toThrow(/64 hex/);
  });
});
